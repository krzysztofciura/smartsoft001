import { INestApplication } from '@nestjs/common';
import { RouterModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import { sessionTablesSql } from './pg-session.store';
import { sessionRoute } from './session.http';
import { SessionModule } from './session.module';
import { teamAccount, teamSetup } from '../testing/fixtures';

const rejected = (work: Promise<unknown>, status: number, code?: string) =>
  expect(work).rejects.toMatchObject({ status, ...(code ? { code } : {}) });

describe('auth-session: SessionTeamService', () => {
  it('lists the members and the recent confirmed accounts without a role', async () => {
    // Arrange
    const { team, provider, candidate, teamStore, ownerSession } = teamSetup();
    teamStore.accountList.push(
      teamAccount('niepotwierdzona@example.com', { confirmed: false }),
    );

    // Act
    const owner = await ownerSession();
    const view = await team.list(owner);

    // Assert
    expect(
      view.members.map((m) => [m.email, m.role, m.self, m.authenticator]),
    ).toEqual([[provider.email, 'owner', true, true]]);
    expect(view.candidates.map((a) => a.email)).toEqual([candidate.email]);
  });

  it('gives an existing confirmed account a role, ends its sessions and refuses duplicates and unknown or unconfirmed addresses', async () => {
    // Arrange
    const { team, store, provider, candidate, teamStore, ownerSession } =
      teamSetup();
    teamStore.accountList.push(
      teamAccount('niepotwierdzona@example.com', { confirmed: false }),
    );
    const owner = await ownerSession();
    store.sessions.set('candidate-session', {
      userId: candidate.id,
      envelope: 'x',
      expires: Date.now() + 60000,
    });

    // Act
    const { id } = await team.grant(owner, candidate.email, 'orders');

    // Assert
    expect(id).toBe(candidate.id);
    expect(store.states.get(candidate.id)?.role).toBe('orders');
    expect(store.sessions.has('candidate-session')).toBe(false);
    expect(teamStore.events).toEqual([
      {
        actor: provider.id,
        subject: candidate.id,
        action: 'grant',
        role: 'orders',
      },
    ]);
    expect((await team.list(owner)).candidates).toEqual([]);
    await rejected(
      team.grant(owner, candidate.email, 'content'),
      409,
      'staff_exists',
    );
    await rejected(
      team.grant(owner, 'nikt@example.com', 'orders'),
      404,
      'not_found',
    );
    await rejected(
      team.grant(owner, 'niepotwierdzona@example.com', 'orders'),
      409,
      'unconfirmed',
    );
    await rejected(
      team.grant(owner, candidate.email, 'admin'),
      400,
      'invalid_input',
    );
  });

  it('changes and removes roles, ends the member sessions and never loses the last owner', async () => {
    // Arrange
    const {
      team,
      store,
      provider,
      candidate,
      veteran,
      teamStore,
      ownerSession,
    } = teamSetup();
    const owner = await ownerSession();
    const { id } = await team.grant(owner, veteran.email, 'content');
    store.sessions.set('member-session', {
      userId: id,
      envelope: 'x',
      expires: Date.now() + 60000,
    });

    // Act
    await team.setRole(owner, id, 'orders');

    // Assert
    expect(store.states.get(id)?.role).toBe('orders');
    expect(store.sessions.has('member-session')).toBe(false);
    await rejected(
      team.setRole(owner, provider.id, 'orders'),
      409,
      'last_owner',
    );
    await rejected(team.remove(owner, provider.id), 409, 'last_owner');
    await rejected(
      team.setRole(owner, candidate.id, 'orders'),
      404,
      'not_found',
    );
    await team.setRole(owner, id, 'owner');
    await team.setRole(owner, provider.id, 'content');
    expect(store.states.get(provider.id)?.role).toBe('content');
    await rejected(team.list(owner), 401, 'session_expired');
    expect(teamStore.events.map((e) => e.action)).toEqual([
      'grant',
      'role',
      'role',
      'role',
    ]);
  });

  it('removes a member with their sessions and keeps the account; a failed change leaves nothing behind', async () => {
    // Arrange
    const { team, store, candidate, teamStore, ownerSession } = teamSetup();
    const owner = await ownerSession();
    const { id } = await team.grant(owner, candidate.email, 'orders');

    // Act
    await team.remove(owner, id);
    teamStore.events.push = () => {
      throw new Error('database down');
    };
    const failed = team.grant(owner, candidate.email, 'orders');

    // Assert
    expect(store.states.get(id)?.role).toBeNull();
    expect(teamStore.accountList.some((a) => a.id === id)).toBe(true);
    await expect(failed).rejects.toThrow('database down');
    expect(store.states.get(id)?.role).toBeNull();
    expect((await team.list(owner)).candidates.map((a) => a.id)).toEqual([id]);
  });

  it('needs the managing permission with AAL2', async () => {
    // Arrange
    const { team, service, provider, store, ownerSession } = teamSetup();
    const aal1 = (await service.login(provider.email, provider.secret)).cookie;
    const owner = await ownerSession();

    // Act
    store.states.get(provider.id)!.role = 'orders';

    // Assert
    await rejected(team.list(aal1), 403, 'access_denied');
    await rejected(team.list(owner), 403, 'access_denied');
  });

  it('bootstraps the first owner only for a team without one', async () => {
    // Arrange
    const { team, store, provider, candidate } = teamSetup();
    store.states.get(provider.id)!.role = null;

    // Act
    const { id } = await team.bootstrap(candidate.email);

    // Assert
    expect(id).toBe(candidate.id);
    expect(store.states.get(id)?.role).toBe('owner');
    await rejected(team.bootstrap(provider.email), 409, 'staff_exists');
    await rejected(team.bootstrap('nikt@example.com'), 404, 'not_found');
  });

  it('declares the team table and a team role separate from the session runtime', () => {
    const sql = sessionTablesSql({
      schema: 'shop_auth',
      runtimeRole: 'shop_auth_runtime',
      roles: ['owner'],
      teamRole: 'shop_auth_team',
    });
    expect(sql).toContain('CREATE TABLE shop_auth.staff_events');
    expect(sql).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON shop_auth.staff TO shop_auth_team;',
    );
    expect(sql).toContain(
      'GRANT SELECT ON shop_auth.staff TO shop_auth_runtime;',
    );
    expect(
      sessionTablesSql({ runtimeRole: 'r', roles: ['owner'] }),
    ).not.toContain('staff_events');
    expect(() =>
      sessionTablesSql({ runtimeRole: 'r', roles: ['owner'], teamRole: 'r' }),
    ).toThrow();
  });
});

describe('auth-session: SessionTeamController', () => {
  let app: INestApplication;
  let base: string;
  let setup: ReturnType<typeof teamSetup>;

  beforeEach(async () => {
    setup = teamSetup();
    const moduleRef = await Test.createTestingModule({
      imports: [
        SessionModule.forRoot({
          service: setup.service,
          team: { store: setup.teamStore, permission: 'store:manage' },
        }),
        RouterModule.register([{ path: 'api/v1', module: SessionModule }]),
      ],
    }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });

  afterEach(() => app.close());

  it('names its routes for an application gate', () => {
    expect(sessionRoute('/api/v1/admin/team', '/api/v1', true)).toBe(true);
    expect(sessionRoute('/api/v1/admin/team/grant', '/api/v1', true)).toBe(
      true,
    );
    expect(sessionRoute('/api/v1/admin/team/grant', '/api/v1')).toBe(false);
    expect(sessionRoute('/api/v1/admin/team/other', '/api/v1', true)).toBe(
      false,
    );
  });

  it('serves the team to an owner with AAL2 and CSRF; a customer session or a foreign origin is refused', async () => {
    // Arrange
    const { provider, config, candidate, factor } = setup;
    const jar: Record<string, string> = {};
    const cookies = () =>
      Object.entries(jar)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
    const keep = (r: Response) => {
      for (const c of r.headers.getSetCookie()) {
        const [pair] = c.split(';');
        const at = pair.indexOf('=');
        jar[pair.slice(0, at)] = pair.slice(at + 1);
      }
      return r;
    };
    const get = async (path: string) =>
      keep(await fetch(base + path, { headers: { cookie: cookies() } }));
    const post = async (
      path: string,
      body: unknown,
      headers: Record<string, string> = {},
    ) =>
      keep(
        await fetch(base + path, {
          method: 'POST',
          headers: {
            cookie: cookies(),
            origin: config.origin,
            'content-type': 'application/json',
            'x-shop-csrf': csrf,
            ...headers,
          },
          body: JSON.stringify(body),
        }),
      );
    const csrf = (await (await get('/api/v1/auth/session')).json()).csrf;

    // Act
    expect((await get('/api/v1/admin/team')).status).toBe(401);
    await post('/api/v1/auth/login', {
      email: provider.email,
      password: provider.secret,
    });
    expect((await get('/api/v1/admin/team')).status).toBe(403);
    await post('/api/v1/auth/mfa/verify', { factor, code: '123456' });
    const view = await (await get('/api/v1/admin/team')).json();
    const granted = await post('/api/v1/admin/team/grant', {
      email: candidate.email,
      role: 'content',
    });

    // Assert
    expect(view.members.map((m: { email: string }) => m.email)).toEqual([
      provider.email,
    ]);
    expect(view.candidates.map((a: { email: string }) => a.email)).toEqual([
      candidate.email,
    ]);
    expect(granted.status).toBe(200);
    expect(await granted.json()).toEqual({ id: candidate.id });
    expect(
      (
        await post(
          '/api/v1/admin/team/grant',
          { email: candidate.email, role: 'content' },
          { origin: 'https://evil.example' },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await post('/api/v1/admin/team/grant', {
          email: candidate.email,
          role: 'content',
          extra: 1,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post('/api/v1/admin/team/role', {
          id: 'not-a-uuid',
          role: 'orders',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post('/api/v1/admin/team/role', {
          id: candidate.id,
          role: 'orders',
        })
      ).status,
    ).toBe(200);
    expect(
      (await post('/api/v1/admin/team/remove', { id: candidate.id })).status,
    ).toBe(200);
    expect((await get('/api/v1/admin/team?x=1')).status).toBe(400);
    expect((await post('/api/v1/admin/team', {})).status).toBe(405);
  });
});
