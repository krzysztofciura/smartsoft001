import type { Pool } from 'pg';

import {
  PgSessionStore,
  sessionTablesSql,
  verifySessionRole,
} from './pg-session.store';

function fakePool(
  answer: (sql: string) => unknown[] = () => [],
  failRollback = false,
) {
  const queries: string[] = [];
  let released: boolean | undefined;
  const run = async (sql: string) => {
    queries.push(sql.replace(/\s+/g, ' ').trim());
    if (sql === 'ROLLBACK' && failRollback) throw new Error('connection lost');
    return { rows: answer(sql) };
  };
  const client = {
    query: run,
    release: (discard?: boolean) => (released = !!discard),
  };
  const pool = { query: run, connect: async () => client } as unknown as Pool;
  return { pool, queries, released: () => released };
}

describe('auth-session: PgSessionStore', () => {
  it('refuses unsafe schema names', () => {
    expect(
      () => new PgSessionStore(fakePool().pool, 'x; DROP TABLE y'),
    ).toThrow('Invalid session schema');
    expect(() =>
      sessionTablesSql({ runtimeRole: 'r', roles: ["owner') OR (true"] }),
    ).toThrow('Invalid staff roles');
  });

  it('runs the work of one user in a locked transaction in the configured schema', async () => {
    const { pool, queries, released } = fakePool((sql) =>
      sql.includes('revoked_before, s.mfa_bound')
        ? [
            {
              revoked_before: '5',
              mfa_bound: true,
              role: 'owner',
              closing: false,
            },
          ]
        : [],
    );
    const store = new PgSessionStore(pool, 'shop_auth');
    const state = await store.user('u1', async (tx) => {
      await tx.revoke();
      return tx.state();
    });
    expect(state).toEqual({
      revokedBefore: 5,
      mfaBound: true,
      role: 'owner',
      closing: false,
    });
    expect(queries[0]).toBe('BEGIN');
    expect(queries[1]).toContain('pg_advisory_xact_lock');
    expect(
      queries.slice(2).every((q) => q === 'COMMIT' || q.includes('shop_auth.')),
    ).toBe(true);
    expect(queries.at(-1)).toBe('COMMIT');
    expect(released()).toBe(false);
  });

  it('rolls back on failure and discards the connection when the rollback fails', async () => {
    const ok = fakePool();
    await expect(
      new PgSessionStore(ok.pool).user('u1', async () =>
        Promise.reject(new Error('work')),
      ),
    ).rejects.toThrow('work');
    expect(ok.queries.at(-1)).toBe('ROLLBACK');
    expect(ok.released()).toBe(false);
    const broken = fakePool(() => [], true);
    await expect(
      new PgSessionStore(broken.pool).user('u1', async () =>
        Promise.reject(new Error('work')),
      ),
    ).rejects.toThrow('work');
    expect(broken.released()).toBe(true);
  });

  it('counts attempts in the database and verifies the runtime role', async () => {
    const counting = fakePool(() => [{ count: 3 }]);
    expect(await new PgSessionStore(counting.pool).attempt('k', 3, 1000)).toBe(
      true,
    );
    expect(await new PgSessionStore(counting.pool).attempt('k', 2, 1000)).toBe(
      false,
    );
    const role = (row: Record<string, boolean>) =>
      fakePool(() => [
        {
          rolsuper: false,
          rolbypassrls: false,
          rolcreaterole: false,
          rolcreatedb: false,
          member: true,
          staff_write: false,
          schema_write: false,
          ...row,
        },
      ]).pool;
    await expect(
      verifySessionRole(role({}), { runtimeRole: 'app_runtime' }),
    ).resolves.toBeUndefined();
    for (const unsafe of [
      'rolsuper',
      'rolbypassrls',
      'staff_write',
      'schema_write',
    ])
      await expect(
        verifySessionRole(role({ [unsafe]: true }), {
          runtimeRole: 'app_runtime',
        }),
      ).rejects.toThrow('Invalid session database role');
    await expect(
      verifySessionRole(role({ member: false }), {
        runtimeRole: 'app_runtime',
      }),
    ).rejects.toThrow();
  });

  it('generates the tables with least-privilege grants', () => {
    const sql = sessionTablesSql({
      schema: 'app_auth',
      runtimeRole: 'app_auth_runtime',
      roles: ['owner', 'support'],
    });
    expect(sql).toContain("CHECK (role IN ('owner','support'))");
    expect(sql).toContain(
      'GRANT SELECT ON app_auth.staff TO app_auth_runtime;',
    );
    expect(sql).toContain(
      'GRANT INSERT ON app_auth.account_events TO app_auth_runtime;',
    );
    expect(sql).not.toMatch(
      /GRANT [^;]*(UPDATE|DELETE)[^;]*app_auth\.(staff|account_events|deletion_requests)/,
    );
  });
});
