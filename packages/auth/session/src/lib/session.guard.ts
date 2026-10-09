import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { requestSession, requireSessionCsrf } from './session.http';
import { SessionService } from './session.service';
import { SessionError } from './session.types';

export const SESSION_PERMISSION = 'smartsoft:session-permission';

/** The permission `SessionGuard` requires for a controller or handler; without it any staff role is enough. */
export const SessionPermission = (permission: string) =>
  SetMetadata(SESSION_PERMISSION, permission);

/** `req.user` set by `SessionGuard`, read with `@User()` from `@smartsoft001/nestjs`. */
export interface ISessionUser {
  id: string;
  role: string;
  permissions: string[];
}

/**
 * Lets a request through for a staff member with an AAL2 session (and the
 * `@SessionPermission()`), checking CSRF for every method other than GET and
 * HEAD, and sets `req.user`. The check happens before the handler runs; work
 * that must not outlive a revocation belongs in
 * `SessionService.withAuthorization`, which holds the user's transaction.
 * Failures are `HttpException`s with `{ code }`.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly service: SessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: ISessionUser }>();
    const required = this.reflector.getAllAndOverride<string | undefined>(
      SESSION_PERMISSION,
      [context.getHandler(), context.getClass()],
    );
    try {
      if (!['GET', 'HEAD'].includes(req.method))
        requireSessionCsrf(req, this.service);
      req.user = await this.service.withAuthorization(
        requestSession(req, this.service),
        required,
        async (actor) => ({
          id: actor.id,
          role: actor.role,
          permissions: actor.permissions,
        }),
      );
      return true;
    } catch (error) {
      if (error instanceof SessionError)
        throw new HttpException({ code: error.code }, error.status);
      throw error;
    }
  }
}
