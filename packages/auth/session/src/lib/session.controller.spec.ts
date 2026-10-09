import { INestApplication } from '@nestjs/common';
import { RouterModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import { sessionRoute } from './session.http';
import { SessionModule } from './session.module';
import { SessionError } from './session.types';
import { sessionSetup } from '../testing/fixtures';

describe('auth-session: SessionController', () => {
  let app: INestApplication;
  let base: string;
  let setup: ReturnType<typeof sessionSetup>;

  beforeEach(async () => {
    setup = sessionSetup();
    const moduleRef = await Test.createTestingModule({
      imports: [
        SessionModule.forRoot({
          service: setup.service,
          messages: { csrf: 'Odśwież stronę.' },
          exporter: async () => ({ orders: [] }),
          exportFormat: 'test-export-v1',
          exportFile: 'data.json',
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
    expect(sessionRoute('/api/v1/auth/session', '/api/v1')).toBe(true);
    expect(sessionRoute('/api/v1/auth/mfa/verify', '/api/v1')).toBe(true);
    expect(sessionRoute('/api/v1/admin/access', '/api/v1')).toBe(true);
    expect(sessionRoute('/api/v1/auth/other', '/api/v1')).toBe(false);
    expect(sessionRoute('/api/v1/admin/products', '/api/v1')).toBe(false);
  });

  it('enforces origin, CSRF, bounded JSON and field allowlists and never returns provider tokens', async () => {
    const { provider, config } = setup;
    const bootstrap = await fetch(base + '/api/v1/auth/session');
    const state = await bootstrap.json();
    let cookie = bootstrap.headers.getSetCookie()[0].split(';')[0];
    expect(state).toMatchObject({ user: null, mailEnabled: false });
    expect(bootstrap.headers.get('set-cookie')).toMatch(
      /HttpOnly; SameSite=Strict/,
    );
    expect(cookie.startsWith('shop_csrf=')).toBe(true);
    const post = (
      path: string,
      body: unknown,
      headers: Record<string, string> = {},
    ) =>
      fetch(base + '/api/v1/auth/' + path, {
        method: 'POST',
        headers: {
          cookie,
          origin: config.origin,
          'content-type': 'application/json',
          'x-shop-csrf': state.csrf,
          ...headers,
        },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
    const login = { email: provider.email, password: provider.secret };

    const foreign = await post('login', login, {
      origin: 'https://evil.example',
    });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toMatchObject({
      code: 'csrf',
      error: 'Odśwież stronę.',
    });
    expect(
      (await post('login', login, { 'x-shop-csrf': 'a'.repeat(64) })).status,
    ).toBe(403);
    expect(
      (await post('login', login, { 'sec-fetch-site': 'cross-site' })).status,
    ).toBe(403);
    expect((await post('login', { ...login, role: 'owner' })).status).toBe(400);
    expect(
      (await post('login', { ...login, password: 'a'.repeat(9000) })).status,
    ).toBe(413);
    expect((await post('login', '{', {})).status).toBe(400);
    expect(
      (await post('login', login, { 'content-type': 'text/plain' })).status,
    ).toBe(415);
    expect((await fetch(base + '/api/v1/auth/session?x=1')).status).toBe(400);
    expect((await fetch(base + '/api/v1/auth/login')).status).toBe(405);

    const response = await post('login', login);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const session = response.headers.getSetCookie()[0];
    expect(session).toMatch(
      /^shop_session=[A-Za-z0-9_-]{43};.*HttpOnly; SameSite=Strict/,
    );
    cookie += '; ' + session.split(';')[0];

    const me = await (
      await fetch(base + '/api/v1/auth/session', { headers: { cookie } })
    ).json();
    expect(me.user).toMatchObject({
      role: 'customer',
      email: provider.email,
      permissions: [],
    });
    expect(JSON.stringify(me)).not.toContain('fixture');
    expect(
      (await fetch(base + '/api/v1/admin/access', { headers: { cookie } }))
        .status,
    ).toBe(403);

    const exported = await post('export', {});
    expect(exported.headers.get('content-disposition')).toBe(
      'attachment; filename="data.json"',
    );
    expect(await exported.json()).toMatchObject({
      format: 'test-export-v1',
      account: { id: provider.id },
      orders: [],
    });

    const out = await post('logout', {});
    expect(out.status).toBe(200);
    expect(out.headers.getSetCookie()[0]).toMatch(/^shop_session=;/);
    expect(
      (
        await (
          await fetch(base + '/api/v1/auth/session', { headers: { cookie } })
        ).json()
      ).user,
    ).toBeNull();
  });

  it('answers 429 with Retry-After and grants staff access only with TOTP', async () => {
    const { provider, config, store, service } = setup;
    const bootstrap = await fetch(base + '/api/v1/auth/session');
    const state = await bootstrap.json();
    let cookie = bootstrap.headers.getSetCookie()[0].split(';')[0];
    const post = (path: string, body: unknown) =>
      fetch(base + '/api/v1/auth/' + path, {
        method: 'POST',
        headers: {
          cookie,
          origin: config.origin,
          'content-type': 'application/json',
          'x-shop-csrf': state.csrf,
        },
        body: JSON.stringify(body),
      });
    const signed = await post('login', {
      email: provider.email,
      password: provider.secret,
    });
    cookie += '; ' + signed.headers.getSetCookie()[0].split(';')[0];
    store.states.get(provider.id)!.role = 'orders';
    const enrolled = await (await post('mfa/enroll', {})).json();
    const verified = await post('mfa/verify', {
      factor: enrolled.factor,
      code: '123456',
    });
    expect(verified.status).toBe(200);
    cookie = cookie.replace(
      /shop_session=[^;]+/,
      verified.headers.getSetCookie()[0].split(';')[0],
    );
    expect(
      await (
        await fetch(base + '/api/v1/admin/access', { headers: { cookie } })
      ).json(),
    ).toEqual({
      role: 'orders',
      permissions: ['orders:read', 'orders:write'],
    });

    service.limit = async () => {
      throw new SessionError(429, 'too_many_attempts');
    };
    const limited = await post('logout', {});
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('600');
  });
});
