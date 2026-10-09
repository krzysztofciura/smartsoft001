import { Inject, Injectable } from '@nestjs/common';

import { createHash, createHmac, randomBytes } from 'crypto';

import { SessionCipher } from './session.cipher';
import { defaultPasswordPolicy, SessionConfig } from './session.config';
import {
  IIdentityProvider,
  IIdentityTokens,
  IIdentityUser,
  ISessionData,
  ISessionSecurityState,
  ISessionStore,
  ISessionTransaction,
  SessionError,
  SessionScope,
} from './session.types';

export const SESSION_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Normalized e-mail address, or `invalid_input`. */
export function sessionEmail(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  )
    throw new SessionError(400, 'invalid_input');
  return value.trim().toLowerCase();
}

/**
 * A password from a request. `fresh` passwords must pass the policy; existing
 * ones only need to be a non-empty string within the provider's 72-byte limit.
 */
export function sessionPassword(
  value: unknown,
  fresh = true,
  policy: SessionConfig['passwordPolicy'] = defaultPasswordPolicy,
): string {
  if (typeof value !== 'string' || value.includes('\0') || !value.length)
    throw new SessionError(400, 'password_policy');
  if (Buffer.byteLength(value, 'utf8') > 72)
    throw new SessionError(400, 'password_too_long');
  const problem = fresh ? (policy ?? defaultPasswordPolicy)(value) : null;
  if (problem) throw new SessionError(400, problem);
  return value;
}

export const hashSession = (value: string) =>
  createHash('sha256').update(value).digest('hex');

/** The signed-in staff member handed to authorized work. */
export interface ISessionActor {
  id: string;
  role: string;
  permissions: string[];
  sessionHash: string;
}

/** A signed-in customer (or any account) handed to customer work. */
export interface ISessionCustomer {
  id: string;
  email: string;
}

/**
 * Sessions of a backend-for-frontend: the browser holds only a random
 * `HttpOnly` cookie, the provider's tokens stay on the server sealed per row,
 * every request re-checks the user with the provider, staff need a role and a
 * TOTP-confirmed (AAL2) session, and revocation is immediate.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(SessionConfig) readonly config: SessionConfig,
    @Inject(ISessionStore) readonly store: ISessionStore,
    @Inject(IIdentityProvider) private readonly provider: IIdentityProvider,
  ) {}

  /** Permissions of a role (none for customers). */
  permissions(role: string | null): string[] {
    return role ? [...(this.config.roles?.[role] ?? [])] : [];
  }

  /** Hash of a user id for event and deletion records that must not hold the id itself. */
  accountMarker(userId: string): string {
    return createHash('sha256')
      .update(
        (this.config.accountMarkerPrefix ?? 'smartsoft-account:') + userId,
      )
      .digest('hex');
  }

  csrf(seed: string): string {
    return createHmac('sha256', this.config.key)
      .update('csrf:' + seed)
      .digest('hex');
  }

  /** Counts an attempt for `subject` (stored as an HMAC, never in clear); `too_many_attempts` over the limit. */
  async limit(subject: string, limit = 10, windowMs = 600000): Promise<void> {
    const key = createHmac('sha256', this.config.key)
      .update('rate:' + subject)
      .digest('hex');
    if (!(await this.store.attempt(key, limit, windowMs)))
      throw new SessionError(429, 'too_many_attempts');
  }

  password(value: unknown, fresh = true): string {
    return sessionPassword(value, fresh, this.config.passwordPolicy);
  }

  async login(address: string, secret: string) {
    await this.limit('email:' + address);
    const started = await this.store.now();
    return this.create(
      await this.provider.login(address, secret),
      'account',
      started,
    );
  }

  async register(address: string, secret: string): Promise<void> {
    if (!this.config.mailEnabled)
      throw new SessionError(503, 'mail_unavailable');
    await this.limit('email:' + address);
    await this.provider.signup(address, secret);
  }

  async requestRecovery(address: string): Promise<void> {
    if (!this.config.mailEnabled)
      throw new SessionError(503, 'mail_unavailable');
    await this.limit('email:' + address, 5, 3600000);
    await this.provider.recover(address);
  }

  async verify(address: string, code: string, type: 'signup' | 'recovery') {
    await this.limit('verify:' + address, 8, 600000);
    const started = await this.store.now();
    const tokens = await this.provider.verify(address, code, type);
    if (type === 'signup') {
      await this.provider.logout(tokens.access_token, 'local');
      return null;
    }
    return this.create(tokens, 'recovery', started);
  }

  /** The signed-in account as the client may see it. */
  async view(cookie: string) {
    return this.use(cookie, async (s, u, state) => ({
      id: u.id,
      email: u.email,
      expires: s.expires,
      scope: s.scope,
      role: state.role ?? 'customer',
      aal: s.aal,
      permissions:
        s.scope === 'account' && s.aal === 'aal2' && this.totp(u)
          ? this.permissions(state.role)
          : [],
      factors: (u.factors ?? [])
        .filter((f) => f.factor_type === 'totp')
        .map((f) => ({ id: f.id, verified: f.status === 'verified' })),
      mfaRequired:
        !!state.role ||
        state.mfaBound ||
        !!u.factors?.some((f) => f.status === 'verified'),
      mfaBound: state.mfaBound,
    }));
  }

  async authorize(cookie: string, required?: string) {
    return this.withAuthorization(cookie, required, async (actor) => ({
      role: actor.role,
      permissions: actor.permissions,
    }));
  }

  /** Work of a signed-in account; an account with a bound authenticator (and every staff account) needs AAL2. */
  async withCustomer<T>(
    cookie: string,
    work: (customer: ISessionCustomer) => Promise<T>,
  ): Promise<T> {
    return this.use(cookie, async (s, u, state) => {
      const verified = this.totp(u);
      if (
        s.scope !== 'account' ||
        ((state.role || state.mfaBound || verified) &&
          (s.aal !== 'aal2' || !verified))
      )
        throw new SessionError(403, 'mfa_required');
      return work({ id: u.id, email: u.email });
    });
  }

  /**
   * Work done on behalf of a staff member (e.g. an agent token issued by them):
   * refused once their role changes, their authenticator is gone or their
   * sessions were revoked after `issued`.
   */
  async withDelegation<T>(
    userId: string,
    issued: number,
    work: () => Promise<T>,
    role = 'owner',
  ): Promise<T> {
    return this.store.user(userId, async (tx) => {
      const state = await tx.state();
      if (
        state.role !== role ||
        !state.mfaBound ||
        state.revokedBefore >= issued
      )
        throw new SessionError(401, 'delegation_revoked');
      return work();
    });
  }

  /** Work of a staff member with an AAL2 session and, when given, the `required` permission. */
  async withAuthorization<T>(
    cookie: string,
    required: string | undefined,
    work: (actor: ISessionActor) => Promise<T>,
  ): Promise<T> {
    return this.use(cookie, async (s, u, state, _tx, hash) => {
      const granted = this.permissions(state.role);
      if (
        s.scope !== 'account' ||
        s.aal !== 'aal2' ||
        !state.role ||
        !this.totp(u) ||
        (required && !granted.includes(required))
      )
        throw new SessionError(403, 'access_denied');
      return work({
        id: u.id,
        role: state.role,
        permissions: granted,
        sessionHash: hash,
      });
    });
  }

  async enroll(cookie: string) {
    return this.use(
      cookie,
      async (s, u, state) => {
        if (
          s.scope !== 'account' ||
          state.mfaBound ||
          u.factors?.some((f) => f.status === 'verified')
        )
          throw new SessionError(403, 'mfa_already_bound');
        for (const pending of u.factors ?? [])
          if (
            pending.factor_type === 'totp' &&
            pending.status === 'unverified' &&
            SESSION_UUID.test(pending.id)
          )
            await this.provider.removePending(s.token, pending.id);
        const result = await this.provider.enroll(s.token);
        if (
          !SESSION_UUID.test(result.id) ||
          typeof result.totp?.secret !== 'string' ||
          !/^[A-Z2-7]{4,128}$/.test(result.totp.secret) ||
          typeof result.totp.qr_code !== 'string' ||
          Buffer.byteLength(result.totp.qr_code) > 786432
        )
          throw new SessionError(503, 'unavailable');
        // The SVG is shown only as an inert image; provider markup never goes into HTML.
        return {
          factor: result.id,
          secret: result.totp.secret,
          qr:
            'data:image/svg+xml;base64,' +
            Buffer.from(result.totp.qr_code).toString('base64'),
        };
      },
      { subject: 'mfa', limit: 10 },
    );
  }

  async mfa(cookie: string, factor: string, code: string) {
    return this.use(
      cookie,
      async (s, u, _state, tx, oldHash) => {
        if (
          !u.factors?.some((f) => f.id === factor && f.factor_type === 'totp')
        )
          throw new SessionError(403, 'access_denied');
        const tokens = await this.provider.mfa(s.token, factor, code);
        const next = await this.session(tokens, s.scope, s.expires);
        if (next.userId !== s.userId || next.aal !== 'aal2')
          throw new SessionError(403, 'access_denied');
        const nextCookie = randomBytes(32).toString('base64url');
        const nextHash = hashSession(nextCookie);
        await tx.remove(oldHash);
        await tx.save(nextHash, next, this.seal(next, nextHash));
        await tx.bindMfa();
        return { cookie: nextCookie, expires: next.expires };
      },
      { subject: 'mfa', limit: 10 },
    );
  }

  /** The account's own data for download; the caller adds what other modules hold. Each export is recorded by marker only. */
  async exportData<T>(
    cookie: string,
    collect: (customer: ISessionCustomer) => Promise<T>,
  ) {
    return this.use(
      cookie,
      async (s, u, state, tx) => {
        if (s.scope !== 'account') throw new SessionError(403, 'access_denied');
        this.requireMfa(s, u, state);
        const data = await collect({ id: u.id, email: u.email });
        await tx.event(this.accountMarker(u.id), 'export');
        return {
          account: {
            id: u.id,
            email: u.email,
            createdAt: u.created_at ?? null,
            lastSignInAt: u.last_sign_in_at ?? null,
            role: state.role ?? 'customer',
            authenticator: this.totp(u),
          },
          data,
        };
      },
      { subject: 'export', limit: 5 },
    );
  }

  /** Deletion on request: every session ends now and no new one starts; a host job removes the account. */
  async closeAccount(cookie: string, current: string): Promise<void> {
    const token = await this.use(
      cookie,
      async (s, u, state, tx) => {
        this.customerAccount(s, u, state);
        await this.prove(u, current);
        await tx.close();
        await tx.event(this.accountMarker(u.id), 'deletion_requested');
        await tx.revoke();
        return s.token;
      },
      { subject: 'close', limit: 5 },
    );
    try {
      await this.provider.logout(token, 'global');
    } catch {
      // Sessions are already gone and sign-in is refused.
    }
  }

  /** E-mail change, step 1: the provider sends a code to the current and to the new address. */
  async requestEmailChange(
    cookie: string,
    next: string,
    current: string,
  ): Promise<void> {
    if (!this.config.mailEnabled)
      throw new SessionError(503, 'mail_unavailable');
    await this.use(
      cookie,
      async (s, u, state) => {
        this.customerAccount(s, u, state);
        if (next === u.email.toLowerCase())
          throw new SessionError(400, 'same_email');
        await this.prove(u, current);
        await this.provider.changeEmail(s.token, next);
      },
      { subject: 'email', limit: 5 },
    );
  }

  /**
   * E-mail change, step 2: both codes. A code accepted earlier is not accepted
   * again, so both are tried and the change counts once the provider returns
   * tokens for this user. Every session ends.
   */
  async confirmEmailChange(
    cookie: string,
    next: string,
    currentCode: string,
    newCode: string,
  ): Promise<void> {
    const token = await this.use(
      cookie,
      async (s, u, state, tx) => {
        this.customerAccount(s, u, state);
        let changed = false;
        const failed: string[] = [];
        for (const [address, code, which] of [
          [u.email, currentCode, 'current'],
          [next, newCode, 'new'],
        ] as const) {
          try {
            const result = await this.provider.verifyEmailChange(address, code);
            if (result.access_token) {
              try {
                if ((await this.provider.user(result.access_token)).id !== u.id)
                  throw new SessionError(403, 'access_denied');
                changed = true;
              } finally {
                await this.provider
                  .logout(result.access_token, 'local')
                  .catch(() => undefined);
              }
            }
          } catch (error) {
            if (!(error instanceof SessionError) || error.status !== 400)
              throw error;
            failed.push(which);
          }
        }
        if (!changed)
          throw new SessionError(
            400,
            failed.length === 2
              ? 'email_codes'
              : failed[0] === 'new'
                ? 'email_code_new'
                : 'email_code_current',
          );
        await tx.event(this.accountMarker(u.id), 'email_changed');
        await tx.revoke();
        return s.token;
      },
      { subject: 'email-code', limit: 8 },
    );
    try {
      await this.provider.logout(token, 'global');
    } catch {
      // Sessions are already revoked.
    }
  }

  async changePassword(
    cookie: string,
    fresh: string,
    current?: string,
  ): Promise<void> {
    this.password(fresh);
    // Revocation is committed even if the provider fails afterwards.
    const token = await this.use(
      cookie,
      async (s, u, state, tx) => {
        this.requireMfa(s, u, state);
        if (s.scope === 'account') await this.prove(u, current);
        await tx.revoke();
        return s.token;
      },
      { subject: 'password', limit: 8 },
    );
    // Serialize password changes and void any sign-in started during the provider call.
    const user = await this.provider.user(token);
    let failure: unknown;
    await this.store.user(user.id, async (tx) => {
      try {
        await this.provider.password(token, fresh);
        await this.provider.logout(token, 'global');
      } catch (error) {
        failure = error;
      } finally {
        await tx.revoke();
      }
    });
    if (failure) throw failure;
  }

  async logout(cookie: string, all: boolean): Promise<void> {
    const token = await this.storedSession(cookie, async (s, tx, hash) => {
      if (all) await tx.revoke();
      else await tx.remove(hash);
      return s.token;
    });
    // Removing the session works during a provider outage too.
    try {
      await this.provider.logout(token, all ? 'global' : 'local');
    } catch {
      // No provider credential is accessible to the browser.
    }
  }

  private get table(): string {
    return (this.config.schema ?? 'auth_session') + '.sessions';
  }

  private seal(session: ISessionData, hash: string): string {
    return new SessionCipher(this.config.key).seal(
      JSON.stringify(session),
      this.table,
      hash,
    );
  }

  private open(envelope: string, hash: string): ISessionData {
    try {
      const value = JSON.parse(
        new SessionCipher(this.config.key).open(envelope, this.table, hash),
      ) as ISessionData;
      if (
        !SESSION_UUID.test(value.userId) ||
        !['account', 'recovery'].includes(value.scope) ||
        !['aal1', 'aal2'].includes(value.aal) ||
        value.expires <= Date.now()
      )
        throw new Error('expired');
      return value;
    } catch {
      throw new SessionError(401, 'session_expired');
    }
  }

  private totp(u: IIdentityUser): boolean {
    return !!u.factors?.some(
      (f) => f.factor_type === 'totp' && f.status === 'verified',
    );
  }

  private async session(
    tokens: IIdentityTokens,
    scope: SessionScope,
    maxExpiry = Date.now() + 3600000,
  ): Promise<ISessionData> {
    // Only tokens returned directly by the configured provider reach here; a browser bearer is never decoded.
    const user = await this.provider.user(tokens.access_token);
    let claims: { sub?: string; exp?: number; aal?: string; role?: string };
    try {
      claims = JSON.parse(
        Buffer.from(
          tokens.access_token.split('.')[1] ?? '',
          'base64url',
        ).toString(),
      );
    } catch {
      throw new SessionError(503, 'unavailable');
    }
    if (
      !SESSION_UUID.test(user.id) ||
      !user.email_confirmed_at ||
      claims.sub !== user.id ||
      claims.role !== 'authenticated' ||
      !claims.exp ||
      !['aal1', 'aal2'].includes(claims.aal ?? '')
    )
      throw new SessionError(401, 'invalid_credentials');
    const expires = Math.min(
      claims.exp * 1000,
      maxExpiry,
      Date.now() + (scope === 'recovery' ? 600000 : 3600000),
    );
    if (expires <= Date.now()) throw new SessionError(401, 'session_expired');
    return {
      userId: user.id,
      token: tokens.access_token,
      aal: claims.aal as ISessionData['aal'],
      scope,
      expires,
    };
  }

  private async create(
    tokens: IIdentityTokens,
    scope: SessionScope,
    started: number,
  ) {
    const session = await this.session(tokens, scope);
    const cookie = randomBytes(32).toString('base64url');
    const hash = hashSession(cookie);
    try {
      await this.store.user(session.userId, async (tx) => {
        const state = await tx.state();
        if (state.closing) throw new SessionError(403, 'account_closing');
        if (state.revokedBefore >= started)
          throw new SessionError(401, 'session_expired');
        await tx.save(hash, session, this.seal(session, hash));
      });
    } catch (error) {
      try {
        await this.provider.logout(tokens.access_token, 'local');
      } catch {
        // The refused session is unusable anyway.
      }
      throw error;
    }
    return { cookie, expires: session.expires };
  }

  private async storedSession<T>(
    cookie: string,
    work: (
      session: ISessionData,
      tx: ISessionTransaction,
      hash: string,
    ) => Promise<T>,
    rate?: { subject: string; limit: number },
  ): Promise<T> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(cookie))
      throw new SessionError(401, 'session_expired');
    const hash = hashSession(cookie);
    const stored = await this.store.read(hash);
    if (!stored) throw new SessionError(401, 'session_expired');
    // Rate-limit by the stored identity before holding a transaction.
    if (rate)
      await this.limit(rate.subject + ':' + stored.userId, rate.limit, 600000);
    return this.store.user(stored.userId, async (tx) => {
      const current = await tx.read(hash);
      if (!current) throw new SessionError(401, 'session_expired');
      const session = this.open(current.envelope, hash);
      if (session.userId !== stored.userId)
        throw new SessionError(401, 'session_expired');
      return work(session, tx, hash);
    });
  }

  private async use<T>(
    cookie: string,
    work: (
      session: ISessionData,
      user: IIdentityUser,
      state: ISessionSecurityState,
      tx: ISessionTransaction,
      hash: string,
    ) => Promise<T>,
    rate?: { subject: string; limit: number },
  ): Promise<T> {
    return this.storedSession(
      cookie,
      async (session, tx, hash) => {
        const user = await this.provider.user(session.token);
        if (user.id !== session.userId || !user.email_confirmed_at)
          throw new SessionError(401, 'session_expired');
        return work(session, user, await tx.state(), tx, hash);
      },
      rate,
    );
  }

  /** The current password again, checked by the provider for this very user; the proof session ends at once. */
  private async prove(user: IIdentityUser, current: unknown): Promise<void> {
    const proof = await this.provider.login(
      user.email,
      this.password(current, false),
    );
    try {
      if ((await this.provider.user(proof.access_token)).id !== user.id)
        throw new SessionError(401, 'invalid_credentials');
    } finally {
      await this.provider.logout(proof.access_token, 'local');
    }
  }

  private requireMfa(
    s: ISessionData,
    u: IIdentityUser,
    state: ISessionSecurityState,
  ): void {
    if (
      (state.role ||
        u.factors?.some((f) => f.status === 'verified') ||
        state.mfaBound) &&
      s.aal !== 'aal2'
    )
      throw new SessionError(403, 'mfa_required');
  }

  /** Only customer accounts change their own address or close themselves; staff accounts are managed by an owner. */
  private customerAccount(
    s: ISessionData,
    u: IIdentityUser,
    state: ISessionSecurityState,
  ): void {
    if (s.scope !== 'account') throw new SessionError(403, 'access_denied');
    if (state.role) throw new SessionError(403, 'staff_account');
    this.requireMfa(s, u, state);
  }
}
