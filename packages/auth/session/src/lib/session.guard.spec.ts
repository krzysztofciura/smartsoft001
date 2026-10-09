import {
  Controller,
  Get,
  INestApplication,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';

import { SessionGuard, SessionPermission } from './session.guard';
import { SessionModule } from './session.module';
import { sessionSetup } from '../testing/fixtures';

@Controller('reports')
@UseGuards(SessionGuard)
class ReportsController {
  @Get()
  @SessionPermission('orders:read')
  read(@Req() req: Request & { user?: unknown }) {
    return req.user;
  }

  @Post()
  @SessionPermission('store:manage')
  write() {
    return { ok: true };
  }
}

describe('auth-session: SessionGuard', () => {
  let app: INestApplication;
  let base: string;

  afterEach(() => app?.close());

  it('admits staff with an AAL2 session and the permission, checks CSRF and sets req.user', async () => {
    const setup = sessionSetup();
    const { service, provider, store, config } = setup;
    const moduleRef = await Test.createTestingModule({
      imports: [SessionModule.forRoot({ service })],
      controllers: [ReportsController],
    }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');

    const login = await service.login(provider.email, provider.secret);
    const get = (cookie: string) =>
      fetch(base + '/reports', {
        headers: { cookie: 'shop_session=' + cookie },
      });
    const customer = await get(login.cookie);
    expect(customer.status).toBe(403);
    expect(await customer.json()).toEqual({ code: 'access_denied' });
    expect((await get('x'.repeat(43))).status).toBe(401);

    store.states.get(provider.id)!.role = 'orders';
    const factor = await service.enroll(login.cookie);
    const staff = await service.mfa(login.cookie, factor.factor, '123456');
    const allowed = await get(staff.cookie);
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({
      id: provider.id,
      role: 'orders',
      permissions: ['orders:read', 'orders:write'],
    });

    const seed = 'a'.repeat(43);
    const post = (headers: Record<string, string>) =>
      fetch(base + '/reports', {
        method: 'POST',
        headers: {
          cookie: `shop_session=${staff.cookie}; shop_csrf=${seed}`,
          origin: config.origin,
          'content-type': 'application/json',
          ...headers,
        },
        body: '{}',
      });
    expect((await post({})).status).toBe(403);
    const missing = await post({ 'x-shop-csrf': service.csrf(seed) });
    expect(missing.status).toBe(403);
    expect(await missing.json()).toEqual({ code: 'access_denied' });
    store.states.get(provider.id)!.role = 'owner';
    expect((await post({ 'x-shop-csrf': service.csrf(seed) })).status).toBe(
      201,
    );
  });
});
