/**
 * Settings of the session module, registered by the host application
 * (`SessionModule.forRoot({ config, … })`). The class is a DI token and a
 * shape, never constructed with values, hence the definite assignment.
 */
export class SessionConfig {
  /** Exact origin of the application (`https://shop.example.com`); state-changing requests must come from it. */
  origin!: string;
  /** 32 random bytes: seals the stored sessions and signs CSRF tokens and rate-limit keys. Keep it outside the database. */
  key!: Buffer;
  /** HTTPS: cookies are `Secure` and `__Host-` prefixed. */
  secure!: boolean;
  /** Sign-up, recovery and e-mail change send e-mail codes; without mail they answer `mail_unavailable`. */
  mailEnabled!: boolean;
  /** Staff role to permissions; customers (no role) have none. */
  roles?: Record<string, string[]>;
  /** Schema of the session tables, also bound into the sealed sessions. Default `auth_session`. */
  schema?: string;
  /** Issuer shown by authenticator apps. Default `Smartsoft`. */
  issuer?: string;
  /** Validates a new password; default `defaultPasswordPolicy`. Existing passwords are checked only by the provider. */
  passwordPolicy?: (
    value: string,
  ) => 'password_policy' | 'password_too_long' | null;
  /**
   * Prefix hashed with the user id into the marker of account events
   * (`SessionService.accountMarker`), so other jobs can match them without
   * the id or e-mail. Default `smartsoft-account:`.
   */
  accountMarkerPrefix?: string;
}

/** Cookie names for a configuration: `__Host-` prefixed on HTTPS. */
export function sessionCookieNames(config: Pick<SessionConfig, 'secure'>): {
  session: string;
  csrf: string;
} {
  const prefix = config.secure ? '__Host-' : '';
  return { session: `${prefix}shop_session`, csrf: `${prefix}shop_csrf` };
}

/**
 * At least 10 characters with a lower-case and an upper-case letter, a digit
 * and a special character; at most 72 UTF-8 bytes (the bcrypt limit of
 * Supabase Auth).
 */
export function defaultPasswordPolicy(
  value: string,
): 'password_policy' | 'password_too_long' | null {
  if (Buffer.byteLength(value, 'utf8') > 72) return 'password_too_long';
  const mixed =
    /\p{Ll}/u.test(value) &&
    /\p{Lu}/u.test(value) &&
    /\p{Nd}/u.test(value) &&
    /[^\p{L}\p{N}]/u.test(value);
  return value.length < 10 || !mixed ? 'password_policy' : null;
}
