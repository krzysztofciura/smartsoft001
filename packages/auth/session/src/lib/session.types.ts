/** What a session cookie stands for. `recovery` can only set a new password. */
export type SessionScope = 'account' | 'recovery';

/** Authenticator assurance of a session: `aal2` after a TOTP code. */
export type SessionAal = 'aal1' | 'aal2';

/** Decrypted session record. `token` is the identity provider's access token, never sent to the browser. */
export interface ISessionData {
  userId: string;
  token: string;
  aal: SessionAal;
  scope: SessionScope;
  expires: number;
}

/** Session row as stored: the user and the sealed `ISessionData`. */
export interface IStoredSession {
  userId: string;
  envelope: string;
}

/**
 * Security state of a user: sessions started before `revokedBefore` are void,
 * `mfaBound` once a TOTP factor was confirmed, `role` from the staff table
 * (null for customers), `closing` after the user asked to delete the account.
 */
export interface ISessionSecurityState {
  revokedBefore: number;
  mfaBound: boolean;
  role: string | null;
  closing: boolean;
}

/** Account events recorded without personal data (`marker` is a hash of the user id). */
export type SessionAccountEvent =
  'export' | 'deletion_requested' | 'email_changed';

/** Operations of one user, serialized per user by `ISessionStore.user`. */
export interface ISessionTransaction {
  state(): Promise<ISessionSecurityState>;
  read(hash: string): Promise<IStoredSession | null>;
  save(hash: string, session: ISessionData, envelope: string): Promise<void>;
  remove(hash: string): Promise<void>;
  /** Ends every session of the user, also those being created right now. */
  revoke(): Promise<void>;
  bindMfa(): Promise<void>;
  /** Records the user's request to delete the account; no new session starts afterwards. */
  close(): Promise<void>;
  event(marker: string, kind: SessionAccountEvent): Promise<void>;
}

/** Storage of sessions, per-user security state and rate-limit counters. */
export abstract class ISessionStore {
  abstract now(): Promise<number>;
  abstract read(hash: string): Promise<IStoredSession | null>;
  /** Counts an attempt for `key`; false once `limit` attempts happened in `windowMs`. */
  abstract attempt(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<boolean>;
  /** Runs `work` for one user under a per-user lock, in one transaction. */
  abstract user<T>(
    id: string,
    work: (tx: ISessionTransaction) => Promise<T>,
  ): Promise<T>;
  abstract ready(): Promise<void>;
  /** Removes expired sessions and counters. */
  abstract cleanup(): Promise<void>;
}

export interface IIdentityUser {
  id: string;
  email: string;
  email_confirmed_at?: string;
  created_at?: string;
  last_sign_in_at?: string;
  factors?: { id: string; factor_type: string; status: string }[];
}

export interface IIdentityTokens {
  access_token: string;
  user?: IIdentityUser;
}

export type IdentityOtpType = 'signup' | 'recovery';

/**
 * The identity provider behind the sessions (passwords, e-mail codes, TOTP).
 * `SupabaseIdentityProvider` implements it with Supabase Auth.
 */
export abstract class IIdentityProvider {
  abstract login(email: string, password: string): Promise<IIdentityTokens>;
  abstract user(token: string): Promise<IIdentityUser>;
  abstract signup(email: string, password: string): Promise<void>;
  abstract recover(email: string): Promise<void>;
  abstract verify(
    email: string,
    code: string,
    type: IdentityOtpType,
  ): Promise<IIdentityTokens>;
  /** Secure e-mail change: the second accepted code (one per mailbox) returns tokens, the first only an acknowledgement. */
  abstract verifyEmailChange(
    email: string,
    code: string,
  ): Promise<Partial<IIdentityTokens>>;
  abstract changeEmail(token: string, email: string): Promise<void>;
  abstract password(token: string, password: string): Promise<void>;
  abstract logout(token: string, scope: 'local' | 'global'): Promise<void>;
  abstract enroll(
    token: string,
  ): Promise<{ id: string; totp: { qr_code: string; secret: string } }>;
  abstract removePending(token: string, factor: string): Promise<void>;
  abstract mfa(
    token: string,
    factor: string,
    code: string,
  ): Promise<IIdentityTokens>;
}

/** An account of the identity provider as the team screen shows it (never a password or token). */
export interface ISessionTeamAccount {
  id: string;
  email: string;
  createdAt: string | null;
  lastSignInAt: string | null;
  /** E-mail confirmed: only confirmed accounts can be given a role. */
  confirmed: boolean;
}

/** Team change recorded with ids only. */
export type SessionTeamAction = 'grant' | 'role' | 'remove';

/** Role changes of one team, all under one lock (the last-owner rule sees every role). */
export interface ISessionTeamTransaction {
  /** Current role of each member. */
  roles(): Promise<Map<string, string>>;
  set(userId: string, role: string): Promise<void>;
  remove(userId: string): Promise<void>;
  /** Ends every session of the member, also those being created right now. */
  revoke(userId: string): Promise<void>;
  event(
    actor: string,
    subject: string,
    action: SessionTeamAction,
    role: string | null,
  ): Promise<void>;
}

/**
 * Storage of staff roles, written by a login separate from the session
 * runtime, and a read-only view of the provider's accounts for the team
 * screen (`PgSessionTeamStore` reads `auth.users` with column grants).
 */
export abstract class ISessionTeamStore {
  abstract roles(): Promise<Map<string, string>>;
  /** Members with their role and whether they ever bound an authenticator. */
  abstract members(): Promise<
    { userId: string; role: string; mfaBound: boolean }[]
  >;
  /** One account by its exact (normalized) address. */
  abstract account(email: string): Promise<ISessionTeamAccount | null>;
  abstract accounts(ids: string[]): Promise<ISessionTeamAccount[]>;
  /** Accounts created in the last `days` days, newest first. */
  abstract recent(days: number): Promise<ISessionTeamAccount[]>;
  abstract change<T>(
    work: (tx: ISessionTeamTransaction) => Promise<T>,
  ): Promise<T>;
  abstract ready(): Promise<void>;
}

/**
 * Failure with an HTTP status and a stable code; `SessionController` turns the
 * code into the configured message. Codes: `invalid_input`, `invalid_credentials`,
 * `session_expired`, `access_denied`, `mfa_required`, `mfa_already_bound`,
 * `password_policy`, `password_too_long`, `too_many_attempts`, `mail_unavailable`,
 * `unavailable`, `csrf`, `account_closing`, `staff_account`, `same_email`,
 * `email_code_current`, `email_code_new`, `email_codes`, `confirmation_required`,
 * `delegation_revoked`, `staff_exists`, `last_owner`, `not_found`, `unconfirmed`.
 */
export class SessionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
