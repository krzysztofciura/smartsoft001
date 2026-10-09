import { createHash, randomUUID } from 'crypto';

import { SessionCipher } from './session.cipher';
import { defaultPasswordPolicy } from './session.config';
import {
  hashSession,
  SessionService,
  sessionEmail,
  sessionPassword,
} from './session.service';
import { SessionError } from './session.types';
import { sessionSetup } from '../testing/fixtures';

const rejected = (work: Promise<unknown>, status: number, code?: string) =>
  expect(work).rejects.toMatchObject({ status, ...(code ? { code } : {}) });

describe('auth-session: SessionService', () => {
  it('validates e-mail and passwords without truncating or normalizing them', () => {
    expect(sessionEmail('  Someone@Example.com ')).toBe('someone@example.com');
    expect(() => sessionEmail('not-an-address')).toThrow(SessionError);
    expect(sessionPassword('  Spacja 1 ')).toBe('  Spacja 1 ');
    expect(sessionPassword('Zażółć#12a')).toBe('Zażółć#12a');
    for (const weak of [
      'Short1!',
      'alllowercase1!',
      'ALLUPPERCASE1!',
      'NoDigitsHere!',
      'NoSpecial123x',
    ])
      expect(() => sessionPassword(weak)).toThrow(
        expect.objectContaining({ code: 'password_policy' }),
      );
    expect(() => sessionPassword('Aa1!' + 'ą'.repeat(35))).toThrow(
      expect.objectContaining({ code: 'password_too_long' }),
    );
    expect(sessionPassword('Aa1!' + 'a'.repeat(68))).toHaveLength(72);
    expect(sessionPassword('anything goes', false)).toBe('anything goes');
    expect(defaultPasswordPolicy('Good password 1')).toBeNull();
  });

  it('applies a custom password policy', () => {
    const { service } = sessionSetup({
      passwordPolicy: (value) => (value.length < 4 ? 'password_policy' : null),
    });
    expect(service.password('abcd')).toBe('abcd');
    expect(() => service.password('abc')).toThrow(
      expect.objectContaining({ code: 'password_policy' }),
    );
  });

  it('keeps the provider token sealed and bound to the session row', async () => {
    const { service, provider, store, config } = sessionSetup({
      schema: 'shop_auth',
    });
    const { cookie } = await service.login(provider.email, provider.secret);
    const hash = hashSession(cookie);
    const envelope = store.sessions.get(hash)!.envelope;
    expect(envelope).not.toContain('eyJ');
    const cipher = new SessionCipher(config.key);
    expect(
      JSON.parse(cipher.open(envelope, 'shop_auth.sessions', hash)).userId,
    ).toBe(provider.id);
    expect(() =>
      cipher.open(envelope, 'shop_auth.sessions', hashSession('other')),
    ).toThrow();
    expect(() =>
      cipher.open(envelope, 'auth_session.sessions', hash),
    ).toThrow();
  });

  it('changes the password after checking the current one and revokes every session', async () => {
    const { service, provider } = sessionSetup();
    const old = provider.secret;
    const a = await service.login(provider.email, old);
    const b = await service.login(provider.email, old);
    await rejected(
      service.changePassword(a.cookie, 'A different password 2', 'wrong'),
      400,
    );
    expect((await service.view(b.cookie)).email).toBe(provider.email);
    await service.changePassword(a.cookie, 'A different password 2', old);
    await rejected(service.view(a.cookie), 401);
    await rejected(service.view(b.cookie), 401);
    await rejected(service.login(provider.email, old), 400);
    expect(
      (await service.login(provider.email, 'A different password 2')).cookie,
    ).toBeTruthy();
  });

  it('requires a role and TOTP for staff; refuses a foreign factor, a replayed cookie, recovery and a missing permission', async () => {
    const { service, provider, store } = sessionSetup();
    let login = await service.login(provider.email, provider.secret);
    store.states.get(provider.id)!.role = 'content';
    await rejected(service.authorize(login.cookie), 403);
    const factor = await service.enroll(login.cookie);
    expect(factor.qr).toMatch(/^data:image\/svg\+xml;base64,/);
    await rejected(service.mfa(login.cookie, randomUUID(), '123456'), 403);
    await rejected(service.mfa(login.cookie, factor.factor, '000000'), 400);
    const upgraded = await service.mfa(login.cookie, factor.factor, '123456');
    await rejected(service.view(login.cookie), 401);
    expect(
      (await service.authorize(upgraded.cookie, 'content:write')).permissions,
    ).toEqual(['content:write']);
    await rejected(service.authorize(upgraded.cookie, 'orders:read'), 403);
    await rejected(service.enroll(upgraded.cookie), 403);
    const recovery = await service.verify(provider.email, '123456', 'recovery');
    await rejected(service.authorize(recovery!.cookie), 403);
    await rejected(
      service.changePassword(recovery!.cookie, 'A different password 2'),
      403,
    );
    const recoveryMfa = await service.mfa(
      recovery!.cookie,
      factor.factor,
      '123456',
    );
    await rejected(service.authorize(recoveryMfa.cookie), 403);
    await service.changePassword(recoveryMfa.cookie, 'A different password 2');
    await rejected(service.view(upgraded.cookie), 401);
    login = await service.login(provider.email, 'A different password 2');
    await rejected(service.authorize(login.cookie), 403);
  });

  it('fails honestly without mail; rate limits and sign-out everywhere survive a new service instance', async () => {
    const { service, provider, store, config } = sessionSetup();
    await rejected(
      service.register(provider.email, provider.secret),
      503,
      'mail_unavailable',
    );
    await rejected(
      service.requestRecovery(provider.email),
      503,
      'mail_unavailable',
    );
    const a = await service.login(provider.email, provider.secret);
    const b = await service.login(provider.email, provider.secret);
    const restarted = new SessionService(config, store, provider);
    expect((await restarted.view(a.cookie)).id).toBe(provider.id);
    await restarted.logout(a.cookie, true);
    await rejected(service.view(b.cookie), 401);
    for (let i = 0; i < 3; i++) await service.limit('test', 3);
    await rejected(restarted.limit('test', 3), 429, 'too_many_attempts');
  });

  it('denies access during a provider outage but still signs out', async () => {
    const { service, provider } = sessionSetup();
    const a = await service.login(provider.email, provider.secret);
    const b = await service.login(provider.email, provider.secret);
    provider.user = async () => {
      throw new SessionError(503, 'unavailable');
    };
    provider.logout = async () => {
      throw new SessionError(503, 'unavailable');
    };
    await rejected(service.view(a.cookie), 503);
    await service.logout(a.cookie, true);
    await rejected(service.view(a.cookie), 401);
    await rejected(service.view(b.cookie), 401);
  });

  it('restarts TOTP setup before verification; a missing bound factor does not restore access', async () => {
    const { service, provider, store } = sessionSetup();
    const a = await service.login(provider.email, provider.secret);
    store.states.get(provider.id)!.role = 'owner';
    const first = await service.enroll(a.cookie);
    const second = await service.enroll(a.cookie);
    expect(first.factor).not.toBe(second.factor);
    expect(provider.factors).toHaveLength(1);
    await rejected(service.mfa(a.cookie, first.factor, '123456'), 403);
    const verified = await service.mfa(a.cookie, second.factor, '123456');
    provider.factors = [];
    expect((await service.view(verified.cookie)).permissions).toEqual([]);
    await rejected(service.authorize(verified.cookie), 403);
    store.states.get(provider.id)!.role = null;
    expect((await service.view(verified.cookie)).mfaRequired).toBe(true);
  });

  it('exports data, closes a customer account and refuses staff accounts', async () => {
    const { service, provider, store } = sessionSetup({
      accountMarkerPrefix: 'app-account:',
    });
    const marker = createHash('sha256')
      .update('app-account:' + provider.id)
      .digest('hex');
    const a = await service.login(provider.email, provider.secret);
    const exported = await service.exportData(a.cookie, async (customer) => ({
      orders: [customer.id],
    }));
    expect(exported.account).toMatchObject({
      id: provider.id,
      role: 'customer',
      authenticator: false,
    });
    expect(exported.data).toEqual({ orders: [provider.id] });
    expect(store.events).toEqual([{ marker, kind: 'export' }]);
    store.states.get(provider.id)!.role = 'orders';
    await rejected(
      service.closeAccount(a.cookie, provider.secret),
      403,
      'staff_account',
    );
    store.states.get(provider.id)!.role = null;
    await rejected(service.closeAccount(a.cookie, 'wrong'), 400);
    await service.closeAccount(a.cookie, provider.secret);
    await rejected(service.view(a.cookie), 401);
    await rejected(
      service.login(provider.email, provider.secret),
      403,
      'account_closing',
    );
    expect(store.events.map((e) => e.kind)).toEqual([
      'export',
      'deletion_requested',
    ]);
  });

  it('changes the e-mail with a code from each mailbox and ends every session', async () => {
    const { service, provider, store } = sessionSetup({ mailEnabled: true });
    const a = await service.login(provider.email, provider.secret);
    await rejected(
      service.requestEmailChange(a.cookie, provider.email, provider.secret),
      400,
      'same_email',
    );
    await service.requestEmailChange(
      a.cookie,
      'new-address@example.com',
      provider.secret,
    );
    await rejected(
      service.confirmEmailChange(
        a.cookie,
        'new-address@example.com',
        '000000',
        '000000',
      ),
      400,
      'email_codes',
    );
    await rejected(
      service.confirmEmailChange(
        a.cookie,
        'new-address@example.com',
        '111111',
        '000000',
      ),
      400,
      'email_code_new',
    );
    await service.confirmEmailChange(
      a.cookie,
      'new-address@example.com',
      '000000',
      '222222',
    );
    expect(provider.email).toBe('new-address@example.com');
    await rejected(service.view(a.cookie), 401);
    expect(store.events.map((e) => e.kind)).toEqual(['email_changed']);
  });

  it('runs delegated work only while the delegating staff member keeps the role, the authenticator and the sessions', async () => {
    const { service, provider, store } = sessionSetup();
    const issued = Date.now();
    await rejected(
      service.withDelegation(provider.id, issued, async () => 1),
      401,
      'delegation_revoked',
    );
    store.states.set(provider.id, {
      revokedBefore: 0,
      mfaBound: true,
      role: 'owner',
      closing: false,
    });
    expect(
      await service.withDelegation(provider.id, issued, async () => 1),
    ).toBe(1);
    await rejected(
      service.withDelegation(provider.id, issued, async () => 1, 'content'),
      401,
    );
    store.states.get(provider.id)!.revokedBefore = issued;
    await rejected(
      service.withDelegation(provider.id, issued, async () => 1),
      401,
    );
  });

  it('lets customers with a bound authenticator act only with an AAL2 session', async () => {
    const { service, provider } = sessionSetup();
    const a = await service.login(provider.email, provider.secret);
    expect(await service.withCustomer(a.cookie, async (c) => c.email)).toBe(
      provider.email,
    );
    const factor = await service.enroll(a.cookie);
    const upgraded = await service.mfa(a.cookie, factor.factor, '123456');
    const plain = await service.login(provider.email, provider.secret);
    await rejected(
      service.withCustomer(plain.cookie, async () => 1),
      403,
      'mfa_required',
    );
    expect(await service.withCustomer(upgraded.cookie, async (c) => c.id)).toBe(
      provider.id,
    );
  });
});
