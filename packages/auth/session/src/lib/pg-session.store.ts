import type { Pool, PoolClient } from 'pg';

import {
  ISessionSecurityState,
  ISessionStore,
  ISessionTransaction,
  IStoredSession,
} from './session.types';

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
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
             FROM ${s}.security s LEFT JOIN ${s}.staff r USING(user_id) WHERE s.user_id=$1`,
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
 * NOLOGIN role granted only what `PgSessionStore` needs; staff are assigned
 * by an administrator, never by the application. Keep the schema out of any
 * public API (e.g. PostgREST).
 */
export function sessionTablesSql(options: {
  schema?: string;
  runtimeRole: string;
  roles: string[];
}): string {
  const s = identifier(options.schema ?? 'auth_session', 'session schema');
  const runtime = identifier(options.runtimeRole, 'runtime role');
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
CREATE TABLE ${s}.staff (user_id uuid PRIMARY KEY, role text NOT NULL CHECK (role IN (${roles})));
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
`;
}
