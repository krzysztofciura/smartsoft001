import type { Request } from 'express';

import { timingSafeEqual } from 'crypto';

import { sessionCookieNames } from './session.config';
import type { SessionService } from './session.service';
import { SessionError } from './session.types';

/** POST actions of `SessionController` under `<prefix>/auth/`. */
export const SESSION_MUTATIONS = [
  'login',
  'register',
  'verify',
  'recovery',
  'password',
  'logout',
  'logout-all',
  'mfa/enroll',
  'mfa/verify',
  'export',
  'close',
  'email',
  'email/verify',
] as const;

export type SessionAction = (typeof SESSION_MUTATIONS)[number];

/** POST actions of the team controller under `<prefix>/admin/team/`. */
export const SESSION_TEAM_MUTATIONS = [
  'grant',
  'role',
  'remove',
  'suspend',
  'resume',
  'revoke',
  'mfa-reset',
] as const;

/**
 * Whether `path` is served by the session controllers mounted at `prefix`
 * (e.g. `/api/v1`), for an application gate that lets through only the routes
 * of enabled modules. `team`: the module also serves team management.
 */
export function sessionRoute(path: string, prefix = '', team = false): boolean {
  const auth = `${prefix}/auth/`;
  const members = `${prefix}/admin/team`;
  return (
    path === `${prefix}/admin/access` ||
    (team &&
      (path === members ||
        (path.startsWith(members + '/') &&
          (SESSION_TEAM_MUTATIONS as readonly string[]).includes(
            path.slice(members.length + 1),
          )))) ||
    path === `${auth}session` ||
    (path.startsWith(auth) &&
      (SESSION_MUTATIONS as readonly string[]).includes(
        path.slice(auth.length),
      ))
  );
}

/** Value of the cookie `name`; empty when missing or sent more than once. */
export function sessionCookie(
  req: Pick<Request, 'headers'>,
  name: string,
): string {
  const matches = (req.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(name + '='));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : '';
}

/** The session cookie of a request. */
export function requestSession(
  req: Pick<Request, 'headers'>,
  service: Pick<SessionService, 'config'>,
): string {
  return sessionCookie(req, sessionCookieNames(service.config).session);
}

/**
 * Checks a state-changing request: exact `Origin`, same-origin fetch metadata,
 * the CSRF header matching the HMAC of the CSRF cookie (double submit, signed)
 * and a JSON body. Throws `SessionError` 403 `csrf` or 415 `invalid_input`.
 */
export function requireSessionCsrf(
  req: Pick<Request, 'headers'>,
  service: Pick<SessionService, 'config' | 'csrf'>,
): void {
  const config = service.config;
  const seed = sessionCookie(req, sessionCookieNames(config).csrf);
  const supplied = req.headers['x-shop-csrf'];
  const site = req.headers['sec-fetch-site'];
  if (
    req.headers.origin !== config.origin ||
    (site && !['same-origin', 'none'].includes(String(site))) ||
    !/^[A-Za-z0-9_-]{43}$/.test(seed) ||
    typeof supplied !== 'string' ||
    !/^[a-f0-9]{64}$/.test(supplied) ||
    !timingSafeEqual(Buffer.from(service.csrf(seed)), Buffer.from(supplied))
  )
    throw new SessionError(403, 'csrf');
  if (
    !/^application\/json(?:;\s*charset=utf-8)?$/i.test(
      req.headers['content-type'] ?? '',
    )
  )
    throw new SessionError(415, 'invalid_input');
}

/** A JSON object with no keys outside `allowed`. */
export function sessionFields(
  body: unknown,
  allowed: string[],
): Record<string, unknown> {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !allowed.includes(key))
  )
    throw new SessionError(400, 'invalid_input');
  return body as Record<string, unknown>;
}

/** A six-digit e-mail or TOTP code. */
export function sessionCode(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{6}$/.test(value))
    throw new SessionError(400, 'invalid_input');
  return value;
}

/** Default (English) messages of `SessionError` codes; an application passes its own with `messages`. */
export const SESSION_MESSAGES: Record<string, string> = {
  staff_exists: 'This account is already a team member.',
  last_owner: 'The team needs at least one owner.',
  own_account:
    'Your own account is managed on the account page, not in the team.',
  not_found: 'No account with this address, or no such team member.',
  unconfirmed: 'The account has not confirmed its e-mail address yet.',
  invalid_input: 'Check the data you entered.',
  invalid_credentials: 'Invalid credentials or code. Try again.',
  session_expired: 'Your session has expired. Sign in again.',
  access_denied:
    'Access denied. The panel requires a role and an authenticator code.',
  mfa_required: 'Confirm the code from your authenticator app.',
  mfa_already_bound: 'This account already has an authenticator.',
  password_policy:
    'The password needs at least 10 characters, with a lower-case and an upper-case letter, a digit and a special character.',
  password_too_long: 'The password is too long: at most 72 bytes.',
  too_many_attempts: 'Too many attempts. Try again later.',
  mail_unavailable: 'Account e-mails are not available yet.',
  unavailable: 'The account service is temporarily unavailable.',
  csrf: 'Reload the page and try again.',
  account_closing: 'This account is waiting for deletion and cannot sign in.',
  staff_account: 'Staff accounts are changed or deleted by the owner.',
  same_email: 'This is the current address of the account.',
  email_code_current:
    'The code from the current mailbox is invalid or expired.',
  email_code_new: 'The code from the new mailbox is invalid or expired.',
  email_codes: 'Both codes are invalid or expired. Ask for new ones.',
};
