import {
  All,
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NestMiddleware,
  Post,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import { json, NextFunction, Request, Response } from 'express';

import { randomBytes } from 'crypto';

import { sessionCookieNames } from './session.config';
import {
  requestSession,
  requireSessionCsrf,
  SESSION_MESSAGES,
  SESSION_MUTATIONS,
  SESSION_TEAM_MUTATIONS,
  sessionCode,
  sessionCookie,
  sessionFields,
} from './session.http';
import { SESSION_UUID, sessionEmail, SessionService } from './session.service';
import { SessionTeamService } from './session.team';
import { SessionError } from './session.types';

/** Messages and the account export of `SessionModule`. */
export class SessionHttpOptions {
  /** Message of each `SessionError` code; missing codes fall back to `SESSION_MESSAGES`. */
  messages?: Record<string, string>;
  /** What other modules keep for the account (e.g. orders), merged into the export. */
  exporter?: (customer: {
    id: string;
    email: string;
  }) => Promise<Record<string, unknown>>;
  /** `format` of the export document and its file name. */
  exportFormat?: string;
  exportFile?: string;
}

function message(options: SessionHttpOptions, code: string): string {
  return (
    options.messages?.[code] ??
    SESSION_MESSAGES[code] ??
    options.messages?.['unavailable'] ??
    SESSION_MESSAGES['unavailable']
  );
}

/** `{ error, code, requestId }`; anything other than `SessionError` is reported as `unavailable`. */
@Catch()
export class SessionErrorFilter implements ExceptionFilter {
  constructor(
    @Inject(SessionHttpOptions) private readonly options: SessionHttpOptions,
  ) {}

  catch(error: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const failure =
      error instanceof SessionError
        ? error
        : new SessionError(503, 'unavailable');
    if (failure.status === 429) res.setHeader('Retry-After', '600');
    res.status(failure.status).json({
      error: message(this.options, failure.code),
      code: failure.code,
      requestId: res.locals?.['requestId'],
    });
  }
}

/** Parses JSON bodies of the session actions, at most 8 KB; failures answer at once. */
@Injectable()
export class SessionBodyMiddleware implements NestMiddleware {
  private readonly parser = json({
    limit: '8kb',
    strict: true,
    type: 'application/json',
  });

  constructor(
    @Inject(SessionHttpOptions) private readonly options: SessionHttpOptions,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    if (req.method !== 'POST') {
      next();
      return;
    }
    this.parser(req, res, (error?: unknown) => {
      if (!error) {
        next();
        return;
      }
      const status =
        (error as { type?: string }).type === 'entity.too.large' ? 413 : 400;
      res.status(status).json({
        error: message(this.options, 'invalid_input'),
        code: 'invalid_input',
        requestId: res.locals?.['requestId'],
      });
    });
  }
}

/**
 * Account sessions of a backend-for-frontend: bootstrap (`GET auth/session`,
 * which also issues the CSRF cookie), sign-in with password, sign-up and
 * recovery codes, TOTP enrolment and verification, password and e-mail
 * change, data export, deletion request and sign-out. Every POST needs the
 * CSRF header and the exact origin; query strings are refused.
 */
@Controller('auth')
@UseFilters(SessionErrorFilter)
export class SessionController {
  constructor(
    private readonly service: SessionService,
    @Inject(SessionHttpOptions) private readonly options: SessionHttpOptions,
  ) {}

  @Get('session')
  async session(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.noQuery(req);
    const names = sessionCookieNames(this.service.config);
    let seed = sessionCookie(req, names.csrf);
    if (!/^[A-Za-z0-9_-]{43}$/.test(seed)) {
      seed = randomBytes(32).toString('base64url');
      res.cookie(names.csrf, seed, { ...this.cookieOptions, maxAge: 3600000 });
    }
    const cookie = requestSession(req, this.service);
    let user = null;
    if (cookie) {
      try {
        user = await this.service.view(cookie);
      } catch (error) {
        if (
          !(error instanceof SessionError) ||
          ![400, 401].includes(error.status)
        )
          throw error;
        res.clearCookie(names.session, this.cookieOptions);
      }
    }
    return {
      user,
      csrf: this.service.csrf(seed),
      mailEnabled: this.service.config.mailEnabled,
    };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    await this.guard(req);
    const b = sessionFields(body, ['email', 'password']);
    return this.issue(
      res,
      await this.service.login(
        sessionEmail(b['email']),
        this.service.password(b['password'], false),
      ),
    );
  }

  @Post('register')
  @HttpCode(200)
  async register(@Req() req: Request, @Body() body: unknown) {
    await this.guard(req);
    const b = sessionFields(body, ['email', 'password']);
    await this.service.register(
      sessionEmail(b['email']),
      this.service.password(b['password']),
    );
    return { ok: true };
  }

  @Post('recovery')
  @HttpCode(200)
  async recovery(@Req() req: Request, @Body() body: unknown) {
    await this.guard(req);
    const b = sessionFields(body, ['email']);
    await this.service.requestRecovery(sessionEmail(b['email']));
    return { ok: true };
  }

  @Post('verify')
  @HttpCode(200)
  async verify(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    await this.guard(req);
    const b = sessionFields(body, ['email', 'code', 'type']);
    if (b['type'] !== 'signup' && b['type'] !== 'recovery')
      throw new SessionError(400, 'invalid_input');
    return this.issue(
      res,
      await this.service.verify(
        sessionEmail(b['email']),
        sessionCode(b['code']),
        b['type'],
      ),
    );
  }

  @Post('mfa/enroll')
  @HttpCode(200)
  async enroll(@Req() req: Request, @Body() body: unknown) {
    await this.guard(req);
    sessionFields(body, []);
    return this.service.enroll(requestSession(req, this.service));
  }

  @Post('mfa/verify')
  @HttpCode(200)
  async mfa(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    await this.guard(req);
    const b = sessionFields(body, ['factor', 'code']);
    if (typeof b['factor'] !== 'string' || !SESSION_UUID.test(b['factor']))
      throw new SessionError(400, 'invalid_input');
    return this.issue(
      res,
      await this.service.mfa(
        requestSession(req, this.service),
        b['factor'],
        sessionCode(b['code']),
      ),
    );
  }

  @Post('password')
  @HttpCode(200)
  async password(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    await this.guard(req);
    const b = sessionFields(body, ['password', 'currentPassword']);
    await this.service.changePassword(
      requestSession(req, this.service),
      this.service.password(b['password']),
      b['currentPassword'] === undefined
        ? undefined
        : this.service.password(b['currentPassword'], false),
    );
    return this.end(res);
  }

  @Post('export')
  @HttpCode(200)
  async export(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    await this.guard(req);
    sessionFields(body, []);
    const exporter = this.options.exporter;
    const result = await this.service.exportData(
      requestSession(req, this.service),
      async (customer) => (exporter ? exporter(customer) : {}),
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${this.options.exportFile ?? 'account.json'}"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    return {
      format: this.options.exportFormat ?? 'smartsoft-account-export-v1',
      exportedAt: new Date().toISOString(),
      account: result.account,
      ...result.data,
    };
  }

  @Post('close')
  @HttpCode(200)
  async close(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    await this.guard(req);
    const b = sessionFields(body, ['password']);
    await this.service.closeAccount(
      requestSession(req, this.service),
      this.service.password(b['password'], false),
    );
    return this.end(res);
  }

  @Post('email')
  @HttpCode(200)
  async email(@Req() req: Request, @Body() body: unknown) {
    await this.guard(req);
    const b = sessionFields(body, ['email', 'password']);
    await this.service.requestEmailChange(
      requestSession(req, this.service),
      sessionEmail(b['email']),
      this.service.password(b['password'], false),
    );
    return { ok: true };
  }

  @Post('email/verify')
  @HttpCode(200)
  async emailVerify(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    await this.guard(req);
    const b = sessionFields(body, ['email', 'currentCode', 'newCode']);
    await this.service.confirmEmailChange(
      requestSession(req, this.service),
      sessionEmail(b['email']),
      sessionCode(b['currentCode']),
      sessionCode(b['newCode']),
    );
    return this.end(res);
  }

  @Post(['logout', 'logout-all'])
  @HttpCode(200)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    await this.guard(req);
    sessionFields(body, []);
    const cookie = requestSession(req, this.service);
    if (cookie) {
      try {
        await this.service.logout(cookie, req.path.endsWith('/logout-all'));
      } catch (error) {
        if (!(error instanceof SessionError) || error.status !== 401)
          throw error;
      }
    }
    return this.end(res);
  }

  /** Other methods on the session paths. */
  @All(['session', ...SESSION_MUTATIONS])
  refuse(): never {
    throw new SessionError(405, 'invalid_input');
  }

  private get cookieOptions() {
    return {
      httpOnly: true,
      secure: this.service.config.secure,
      sameSite: 'strict' as const,
      path: '/',
    };
  }

  private noQuery(req: Request): void {
    if (Object.keys(req.query ?? {}).length)
      throw new SessionError(400, 'invalid_input');
  }

  /** Query, CSRF, origin and JSON checks plus a per-address limit of 60 actions in 10 minutes. */
  private async guard(req: Request): Promise<void> {
    this.noQuery(req);
    requireSessionCsrf(req, this.service);
    await this.service.limit(
      'ip:' + (req.socket?.remoteAddress ?? 'unknown'),
      60,
      600000,
    );
  }

  private issue(
    res: Response,
    issued: { cookie: string; expires: number } | null,
  ) {
    if (issued)
      res.cookie(
        sessionCookieNames(this.service.config).session,
        issued.cookie,
        {
          ...this.cookieOptions,
          maxAge: Math.max(0, issued.expires - Date.now()),
        },
      );
    return { ok: true };
  }

  private end(res: Response) {
    res.clearCookie(
      sessionCookieNames(this.service.config).session,
      this.cookieOptions,
    );
    return { ok: true };
  }
}

/** `GET admin/access`: role and permissions of the signed-in staff member, 403 otherwise. */
@Controller('admin')
@UseFilters(SessionErrorFilter)
export class SessionAccessController {
  constructor(private readonly service: SessionService) {}

  @Get('access')
  access(@Req() req: Request) {
    if (Object.keys(req.query ?? {}).length)
      throw new SessionError(400, 'invalid_input');
    return this.service.authorize(requestSession(req, this.service));
  }

  @All('access')
  refuse(): never {
    throw new SessionError(405, 'invalid_input');
  }
}

/**
 * `admin/team` (with `SessionModule.forRoot({ team })`): `GET` lists the
 * members and the recent accounts that could join, `POST grant`
 * `{ email, role }`, `POST role` `{ id, role }`, `POST remove` `{ id }`,
 * and on one member `{ id }`: `POST suspend`, `POST resume`, `POST revoke`
 * (end the sessions) and `POST mfa-reset` (force a new authenticator).
 * The permission and AAL2 are checked by `SessionTeamService`; every POST
 * needs CSRF, the exact origin and JSON.
 */
@Controller('admin/team')
@UseFilters(SessionErrorFilter)
export class SessionTeamController {
  constructor(
    @Inject(SessionTeamService) private readonly team: SessionTeamService,
    @Inject(SessionService) private readonly service: SessionService,
  ) {}

  @Get()
  list(@Req() req: Request) {
    if (Object.keys(req.query ?? {}).length)
      throw new SessionError(400, 'invalid_input');
    return this.team.list(requestSession(req, this.service));
  }

  @Post('grant')
  @HttpCode(200)
  async grant(@Req() req: Request, @Body() body: unknown) {
    await this.guard(req);
    const b = sessionFields(body, ['email', 'role']);
    return this.team.grant(
      requestSession(req, this.service),
      sessionEmail(b['email']),
      this.text(b['role']),
    );
  }

  @Post('role')
  @HttpCode(200)
  async role(@Req() req: Request, @Body() body: unknown) {
    await this.guard(req);
    const b = sessionFields(body, ['id', 'role']);
    await this.team.setRole(
      requestSession(req, this.service),
      this.id(b['id']),
      this.text(b['role']),
    );
    return { ok: true };
  }

  @Post('remove')
  @HttpCode(200)
  async remove(@Req() req: Request, @Body() body: unknown) {
    await this.guard(req);
    const b = sessionFields(body, ['id']);
    await this.team.remove(requestSession(req, this.service), this.id(b['id']));
    return { ok: true };
  }

  @Post('suspend')
  @HttpCode(200)
  async suspend(@Req() req: Request, @Body() body: unknown) {
    await this.member(req, body, (cookie, id) => this.team.suspend(cookie, id));
    return { ok: true };
  }

  @Post('resume')
  @HttpCode(200)
  async resume(@Req() req: Request, @Body() body: unknown) {
    await this.member(req, body, (cookie, id) => this.team.resume(cookie, id));
    return { ok: true };
  }

  @Post('revoke')
  @HttpCode(200)
  async revoke(@Req() req: Request, @Body() body: unknown) {
    await this.member(req, body, (cookie, id) => this.team.revoke(cookie, id));
    return { ok: true };
  }

  @Post('mfa-reset')
  @HttpCode(200)
  async mfaReset(@Req() req: Request, @Body() body: unknown) {
    await this.member(req, body, (cookie, id) =>
      this.team.resetMfa(cookie, id),
    );
    return { ok: true };
  }

  /** A guarded action on one member named by `{ id }`. */
  private async member(
    req: Request,
    body: unknown,
    action: (cookie: string, id: string) => Promise<void>,
  ): Promise<void> {
    await this.guard(req);
    const b = sessionFields(body, ['id']);
    await action(requestSession(req, this.service), this.id(b['id']));
  }

  @All(['', ...SESSION_TEAM_MUTATIONS])
  refuse(): never {
    throw new SessionError(405, 'invalid_input');
  }

  private async guard(req: Request): Promise<void> {
    if (Object.keys(req.query ?? {}).length)
      throw new SessionError(400, 'invalid_input');
    requireSessionCsrf(req, this.service);
    await this.service.limit(
      'ip:' + (req.socket?.remoteAddress ?? 'unknown'),
      60,
      600000,
    );
  }

  private id(value: unknown): string {
    if (typeof value !== 'string' || !SESSION_UUID.test(value))
      throw new SessionError(400, 'invalid_input');
    return value.toLowerCase();
  }

  private text(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(value))
      throw new SessionError(400, 'invalid_input');
    return value;
  }
}
