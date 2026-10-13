import type { Pool, PoolClient } from 'pg';

import {
  ISessionSecurityState,
  ISessionStore,
  ISessionTeamAccount,
  ISessionTeamStore,
  ISessionTeamTransaction,
  ISessionTransaction,
  IStoredSession,
} from './session.types';

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const QUALIFIED = /^[a-z_][a-z0-9_]{0,62}(\.[a-z_][a-z0-9_]{0,62})?$/;
const CLOCK = '(extract(epoch from clock_timestamp())*1000)::bigint';

function identifier(value: string, what: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Invalid ${what}`);
  return value;
}

/**
 * `ISessionStore` on PostgreSQL. Times come from the database clock, every
 * operation of one user runs in one transaction under a per-user advisory
 * lock, and a rollback that fails discards the connection. Tables:
 * `sessionTablesSql`.
 */
export class PgSessionStore extends ISessionStore {
  private readonly schema: string;

  constructor(
    private readonly pool: Pool,
    schema = 'auth_session',
  ) {
    super();
    this.schema = identifier(schema, 'session schema');
  }

  async ready(): Promise<void> {
    await this.pool.query(`SELECT 1 FROM ${this.schema}.sessions LIMIT 0`);
  }

  async now(): Promise<number> {
    return Number(
      (await this.pool.query(`SELECT ${CLOCK} AS now`)).rows[0].now,
    );
  }

  read(hash: string): Promise<IStoredSession | null> {
    return this.readWith(this.pool, hash);
  }

  async attempt(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<boolean> {
    const s = this.schema;
    const { rows } = await this.pool.query(
      `INSERT INTO ${s}.attempts(key,count,until_ms) VALUES($1,1,${CLOCK}+$2)
       ON CONFLICT(key) DO UPDATE SET
         count=CASE WHEN ${s}.attempts.until_ms<=${CLOCK} THEN 1 ELSE ${s}.attempts.count+1 END,
         until_ms=CASE WHEN ${s}.attempts.until_ms<=${CLOCK} THEN ${CLOCK}+$2 ELSE ${s}.attempts.until_ms END
       RETURNING count`,
      [key, windowMs],
    );
    return rows[0].count <= limit;
  }

  async user<T>(
    id: string,
    work: (tx: ISessionTransaction) => Promise<T>,
  ): Promise<T> {
    const s = this.schema;
    const client = await this.pool.connect();
    let discard = false;
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,731403))',
        [id],
      );
      await client.query(
        `INSERT INTO ${s}.security(user_id) VALUES($1) ON CONFLICT DO NOTHING`,
        [id],
      );
      const tx: ISessionTransaction = {
        state: async () => {
          const { rows } = await client.query(
            `SELECT s.revoked_before, s.mfa_bound, r.role,
               EXISTS(SELECT 1 FROM ${s}.deletion_requests d WHERE d.user_id=s.user_id) AS closing
             FROM ${s}.security s LEFT JOIN ${s}.staff r ON r.user_id=s.user_id AND r.suspended_at IS NULL WHERE s.user_id=$1`,
            [id],
          );
          return {
            revokedBefore: Number(rows[0].revoked_before),
            mfaBound: rows[0].mfa_bound,
            role: rows[0].role,
            closing: rows[0].closing,
          } as ISessionSecurityState;
        },
        read: (hash) => this.readWith(client, hash),
        save: async (hash, session, envelope) => {
          await client.query(
            `INSERT INTO ${s}.sessions(hash,user_id,envelope,expires_at) VALUES($1,$2,$3,$4)
             ON CONFLICT(hash) DO UPDATE SET envelope=$3, expires_at=$4`,
            [hash, id, envelope, session.expires],
          );
        },
        remove: async (hash) => {
          await client.query(
            `DELETE FROM ${s}.sessions WHERE hash=$1 AND user_id=$2`,
            [hash, id],
          );
        },
        revoke: async () => {
          await client.query(
            `UPDATE ${s}.security SET revoked_before=${CLOCK} WHERE user_id=$1`,
            [id],
          );
          await client.query(`DELETE FROM ${s}.sessions WHERE user_id=$1`, [
            id,
          ]);
        },
        bindMfa: async () => {
          await client.query(
            `UPDATE ${s}.security SET mfa_bound=true WHERE user_id=$1`,
            [id],
          );
        },
        close: async () => {
          await client.query(
            `INSERT INTO ${s}.deletion_requests(user_id,requested_ms) VALUES($1,${CLOCK}) ON CONFLICT DO NOTHING`,
            [id],
          );
        },
        event: async (marker, kind) => {
          await client.query(
            `INSERT INTO ${s}.account_events(id,user_hash,kind,at_ms) VALUES(gen_random_uuid(),$1,$2,${CLOCK})`,
            [marker, kind],
          );
        },
      };
      const result = await work(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        discard = true;
      }
      throw error;
    } finally {
      client.release(discard);
    }
  }

  async cleanup(): Promise<void> {
    await this.pool.query(
      `DELETE FROM ${this.schema}.sessions WHERE expires_at<=${CLOCK}`,
    );
    await this.pool.query(
      `DELETE FROM ${this.schema}.attempts WHERE until_ms<=${CLOCK}`,
    );
  }

  private async readWith(
    db: Pool | PoolClient,
    hash: string,
  ): Promise<IStoredSession | null> {
    const { rows } = await db.query(
      `SELECT user_id, envelope FROM ${this.schema}.sessions WHERE hash=$1 AND expires_at>${CLOCK}`,
      [hash],
    );
    return rows[0]
      ? { userId: rows[0].user_id, envelope: rows[0].envelope }
      : null;
  }
}

/** Where `PgSessionTeamStore` keeps roles, finds the sessions it ends and reads accounts. */
export interface IPgSessionTeamOptions {
  /** Schema of `staff` and `staff_events`. Default `auth_session`. */
  schema?: string;
  /** Schema of `security` and `sessions` (the session store's), when the roles live elsewhere. Default `schema`. */
  sessions?: string;
  /**
   * Table of the identity provider's accounts with the columns `id`, `email`,
   * `created_at`, `last_sign_in_at`, `email_confirmed_at`, `deleted_at` and
   * `is_anonymous` (Supabase Auth's `auth.users`): grant the team login
   * SELECT on exactly these columns. Default `auth.users`.
   */
  identities?: string;
  /**
   * Table of the provider's authenticator factors with a `user_id` column
   * (Supabase Auth's `auth.mfa_factors`): grant the team login SELECT and
   * DELETE, so an owner can force a member to enrol a new authenticator.
   * Default `auth.mfa_factors`.
   */
  factors?: string;
}

/**
 * `ISessionTeamStore` on PostgreSQL for a login granted the team role of
 * `sessionTablesSql` (never the session runtime): it writes roles, ends the
 * sessions of a changed member and reads the provider's accounts, nothing
 * more. Every change runs in one transaction under a team-wide advisory
 * lock; revoking a member also takes that member's session lock, so a
 * sign-in in progress cannot slip through.
 */
export class PgSessionTeamStore extends ISessionTeamStore {
  private readonly schema: string;
  private readonly sessions: string;
  private readonly identities: string;
  private readonly factors: string;

  constructor(
    private readonly pool: Pool,
    options: IPgSessionTeamOptions = {},
  ) {
    super();
    this.schema = identifier(options.schema ?? 'auth_session', 'team schema');
    this.sessions = identifier(
      options.sessions ?? this.schema,
      'session schema',
    );
    const identities = options.identities ?? 'auth.users';
    if (!QUALIFIED.test(identities)) throw new Error('Invalid identity table');
    this.identities = identities;
    const factors = options.factors ?? 'auth.mfa_factors';
    if (!QUALIFIED.test(factors)) throw new Error('Invalid factor table');
    this.factors = factors;
  }

  async ready(): Promise<void> {
    await this.pool.query(
      `SELECT suspended_at FROM ${this.schema}.staff LIMIT 0`,
    );
    await this.pool.query(`${this.accountSelect} LIMIT 0`);
    await this.pool.query(`SELECT user_id FROM ${this.factors} LIMIT 0`);
  }

  async roles(): Promise<Map<string, string>> {
    return this.rolesWith(this.pool);
  }

  async members(): Promise<
    { userId: string; role: string; mfaBound: boolean; suspended: boolean }[]
  > {
    const { rows } = await this.pool.query(
      `SELECT r.user_id, r.role, r.suspended_at IS NOT NULL AS suspended, COALESCE(s.mfa_bound,false) AS mfa_bound
       FROM ${this.schema}.staff r LEFT JOIN ${this.sessions}.security s USING(user_id)`,
    );
    return rows.map((row) => ({
      userId: row.user_id,
      role: row.role,
      mfaBound: row.mfa_bound,
      suspended: row.suspended,
    }));
  }

  async account(email: string): Promise<ISessionTeamAccount | null> {
    const { rows } = await this.pool.query(
      `${this.accountSelect} WHERE lower(email)=$1 AND deleted_at IS NULL AND COALESCE(is_anonymous,false)=false LIMIT 1`,
      [email.toLowerCase()],
    );
    return rows[0] ? this.toAccount(rows[0]) : null;
  }

  async accounts(ids: string[]): Promise<ISessionTeamAccount[]> {
    if (!ids.length) return [];
    const { rows } = await this.pool.query(
      `${this.accountSelect} WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    return rows.map((row) => this.toAccount(row));
  }

  async recent(days: number): Promise<ISessionTeamAccount[]> {
    if (!Number.isInteger(days) || days < 1 || days > 3650)
      throw new Error('Invalid day range');
    const { rows } = await this.pool.query(
      `${this.accountSelect} WHERE created_at > now() - make_interval(days => $1) AND deleted_at IS NULL AND COALESCE(is_anonymous,false)=false
       ORDER BY created_at DESC LIMIT 100`,
      [days],
    );
    return rows.map((row) => this.toAccount(row));
  }

  async change<T>(
    work: (tx: ISessionTeamTransaction) => Promise<T>,
  ): Promise<T> {
    const s = this.schema;
    const sessions = this.sessions;
    const factors = this.factors;
    const client = await this.pool.connect();
    let discard = false;
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,731404))',
        [s + ':team'],
      );
      const tx: ISessionTeamTransaction = {
        roles: () => this.rolesWith(client),
        set: async (userId, role) => {
          await client.query(
            `INSERT INTO ${s}.staff(user_id,role) VALUES($1,$2)
             ON CONFLICT(user_id) DO UPDATE SET role=excluded.role`,
            [userId, role],
          );
        },
        remove: async (userId) => {
          await client.query(`DELETE FROM ${s}.staff WHERE user_id=$1`, [
            userId,
          ]);
        },
        suspended: async () => {
          const { rows } = await client.query(
            `SELECT user_id FROM ${s}.staff WHERE suspended_at IS NOT NULL`,
          );
          return new Set<string>(rows.map((row) => row.user_id));
        },
        suspend: async (userId, on) => {
          await client.query(
            `UPDATE ${s}.staff SET suspended_at=${on ? CLOCK : 'NULL'} WHERE user_id=$1`,
            [userId],
          );
        },
        resetMfa: async (userId) => {
          await client.query(
            `INSERT INTO ${sessions}.security(user_id,mfa_bound) VALUES($1,false)
             ON CONFLICT(user_id) DO UPDATE SET mfa_bound=false`,
            [userId],
          );
          await client.query(`DELETE FROM ${factors} WHERE user_id=$1`, [
            userId,
          ]);
        },
        revoke: async (userId) => {
          await client.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1,731403))',
            [userId],
          );
          await client.query(
            `INSERT INTO ${sessions}.security(user_id,revoked_before) VALUES($1,${CLOCK})
             ON CONFLICT(user_id) DO UPDATE SET revoked_before=${CLOCK}`,
            [userId],
          );
          await client.query(
            `DELETE FROM ${sessions}.sessions WHERE user_id=$1`,
            [userId],
          );
        },
        event: async (actor, subject, action, role) => {
          await client.query(
            `INSERT INTO ${s}.staff_events(id,at_ms,actor,subject,action,role)
             VALUES(gen_random_uuid(),${CLOCK},$1,$2,$3,$4)`,
            [actor, subject, action, role],
          );
        },
      };
      const result = await work(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        discard = true;
      }
      throw error;
    } finally {
      client.release(discard);
    }
  }

  private get accountSelect(): string {
    return `SELECT id, email, created_at, last_sign_in_at, email_confirmed_at FROM ${this.identities}`;
  }

  private toAccount(row: Record<string, unknown>): ISessionTeamAccount {
    const iso = (value: unknown) =>
      value instanceof Date
        ? value.toISOString()
        : value
          ? String(value)
          : null;
    return {
      id: String(row['id']),
      email: String(row['email'] ?? ''),
      createdAt: iso(row['created_at']),
      lastSignInAt: iso(row['last_sign_in_at']),
      confirmed: !!row['email_confirmed_at'],
    };
  }

  private async rolesWith(db: Pool | PoolClient): Promise<Map<string, string>> {
    const { rows } = await db.query(
      `SELECT user_id, role FROM ${this.schema}.staff`,
    );
    return new Map(rows.map((row) => [row.user_id, row.role]));
  }
}

/**
 * Refuses to start the team store with a login that could do more than
 * managing roles: superuser, `BYPASSRLS`, role or database creation, DDL in
 * the team schema, or a login outside `teamRole`.
 */
export async function verifyTeamRole(
  pool: Pool,
  options: { schema?: string; teamRole: string },
): Promise<void> {
  const schema = identifier(options.schema ?? 'auth_session', 'team schema');
  const team = identifier(options.teamRole, 'team role');
  const { rows } = await pool.query(
    `SELECT r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
       pg_has_role(current_user,$1,'MEMBER') AS member,
       has_table_privilege(current_user,$2,'INSERT,UPDATE,DELETE') AS staff_write,
       has_schema_privilege(current_user,$3,'CREATE') AS schema_write
     FROM pg_roles r WHERE r.rolname=current_user`,
    [team, `${schema}.staff`, schema],
  );
  const r = rows[0];
  if (
    !r ||
    !r.member ||
    !r.staff_write ||
    r.rolsuper ||
    r.rolbypassrls ||
    r.rolcreaterole ||
    r.rolcreatedb ||
    r.schema_write
  )
    throw new Error('Invalid team database role');
}

/**
 * Refuses to start with a database login that could do more than the
 * sessions need: superuser, `BYPASSRLS`, role or database creation, writes to
 * the staff table or DDL in the schema, or a login outside `runtimeRole`.
 */
export async function verifySessionRole(
  pool: Pool,
  options: { schema?: string; runtimeRole: string },
): Promise<void> {
  const schema = identifier(options.schema ?? 'auth_session', 'session schema');
  const runtime = identifier(options.runtimeRole, 'runtime role');
  const { rows } = await pool.query(
    `SELECT r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
       pg_has_role(current_user,$1,'MEMBER') AS member,
       has_table_privilege(current_user,$2,'INSERT,UPDATE,DELETE,TRUNCATE') AS staff_write,
       has_schema_privilege(current_user,$3,'CREATE') AS schema_write
     FROM pg_roles r WHERE r.rolname=current_user`,
    [runtime, `${schema}.staff`, schema],
  );
  const r = rows[0];
  if (
    !r ||
    !r.member ||
    r.rolsuper ||
    r.rolbypassrls ||
    r.rolcreaterole ||
    r.rolcreatedb ||
    r.staff_write ||
    r.schema_write
  )
    throw new Error('Invalid session database role');
}

/**
 * DDL of the session tables for a new database (a migration of the host
 * application runs it once). `roles` limits `staff.role`; `runtimeRole` is a
 * NOLOGIN role granted only what `PgSessionStore` needs, never staff roles:
 * those are assigned by an administrator or, with `teamRole`, by
 * `PgSessionTeamStore` on its own login. Keep the schema out of any public
 * API (e.g. PostgREST).
 */
export function sessionTablesSql(options: {
  schema?: string;
  runtimeRole: string;
  roles: string[];
  /**
   * NOLOGIN role of `PgSessionTeamStore`: gets the roles, the sessions it
   * ends and `staff_events`; the grant on the identity table (SELECT of the
   * listed columns of `auth.users`) is the host application's, as that table
   * is the provider's.
   */
  teamRole?: string;
}): string {
  const s = identifier(options.schema ?? 'auth_session', 'session schema');
  const runtime = identifier(options.runtimeRole, 'runtime role');
  const team =
    options.teamRole === undefined
      ? null
      : identifier(options.teamRole, 'team role');
  if (team === runtime) throw new Error('The team role must differ');
  if (
    !options.roles.length ||
    options.roles.some((role) => !/^[a-z][a-z0-9_-]{0,31}$/.test(role))
  )
    throw new Error('Invalid staff roles');
  const roles = options.roles.map((role) => `'${role}'`).join(',');
  return `DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${runtime}') THEN
    CREATE ROLE ${runtime} NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
CREATE SCHEMA ${s};
REVOKE ALL ON SCHEMA ${s} FROM PUBLIC;
GRANT USAGE ON SCHEMA ${s} TO ${runtime};
CREATE TABLE ${s}.staff (user_id uuid PRIMARY KEY, role text NOT NULL CHECK (role IN (${roles})), suspended_at bigint);
CREATE TABLE ${s}.security (user_id uuid PRIMARY KEY, revoked_before bigint NOT NULL DEFAULT 0, mfa_bound boolean NOT NULL DEFAULT false);
CREATE TABLE ${s}.sessions (
  hash text PRIMARY KEY CHECK (hash ~ '^[a-f0-9]{64}$'),
  user_id uuid NOT NULL,
  envelope text NOT NULL CHECK (octet_length(envelope) < 32768),
  expires_at bigint NOT NULL
);
CREATE INDEX ON ${s}.sessions(user_id);
CREATE INDEX ON ${s}.sessions(expires_at);
CREATE TABLE ${s}.attempts (key text PRIMARY KEY CHECK (key ~ '^[a-f0-9]{64}$'), count integer NOT NULL, until_ms bigint NOT NULL);
CREATE INDEX ON ${s}.attempts(until_ms);
CREATE TABLE ${s}.deletion_requests (user_id uuid PRIMARY KEY, requested_ms bigint NOT NULL);
CREATE TABLE ${s}.account_events (
  id uuid PRIMARY KEY,
  user_hash text NOT NULL CHECK (user_hash ~ '^[a-f0-9]{64}$'),
  kind text NOT NULL CHECK (kind IN ('export','deletion_requested','email_changed')),
  at_ms bigint NOT NULL
);
CREATE INDEX ON ${s}.account_events(at_ms);
REVOKE ALL ON ALL TABLES IN SCHEMA ${s} FROM PUBLIC;
GRANT SELECT ON ${s}.staff TO ${runtime};
GRANT SELECT, INSERT, UPDATE, DELETE ON ${s}.sessions, ${s}.security, ${s}.attempts TO ${runtime};
GRANT SELECT, INSERT ON ${s}.deletion_requests TO ${runtime};
GRANT INSERT ON ${s}.account_events TO ${runtime};
${
  team
    ? `DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${team}') THEN
    CREATE ROLE ${team} NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
CREATE TABLE ${s}.staff_events (
  id uuid PRIMARY KEY,
  at_ms bigint NOT NULL,
  actor uuid NOT NULL,
  subject uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('grant','role','remove','suspend','resume','revoke','mfa_reset')),
  role text
);
CREATE INDEX ON ${s}.staff_events(at_ms);
REVOKE ALL ON ${s}.staff_events FROM PUBLIC;
GRANT USAGE ON SCHEMA ${s} TO ${team};
GRANT SELECT, INSERT, UPDATE, DELETE ON ${s}.staff TO ${team};
GRANT SELECT, INSERT, UPDATE ON ${s}.security TO ${team};
GRANT SELECT, DELETE ON ${s}.sessions TO ${team};
GRANT SELECT, INSERT ON ${s}.staff_events TO ${team};
`
    : ''
}`;
}
