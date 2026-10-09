import { SupabaseAuthError, SupabaseAuthService } from '@smartsoft001/supabase';

import { SessionError } from './session.types';
import { SupabaseIdentityProvider } from './supabase-identity.provider';

describe('auth-session: SupabaseIdentityProvider', () => {
  const auth = (patch: Partial<SupabaseAuthService>) =>
    Object.assign(
      Object.create(SupabaseAuthService.prototype),
      patch,
    ) as SupabaseAuthService;

  it('turns Supabase Auth failures into session errors with the same status and code', async () => {
    const provider = new SupabaseIdentityProvider(
      auth({
        signInWithPassword: async () => {
          throw new SupabaseAuthError(429, 'too_many_attempts');
        },
        getUser: async () => {
          throw new Error('other');
        },
      }),
    );
    const failure = await provider
      .login('a@example.com', 'x')
      .catch((error) => error);
    expect(failure).toBeInstanceOf(SessionError);
    expect(failure).toMatchObject({ status: 429, code: 'too_many_attempts' });
    await expect(provider.user('t')).rejects.toThrow('other');
  });

  it('requires tokens from a sign-up or recovery code and passes the issuer to TOTP enrolment', async () => {
    const calls: unknown[] = [];
    const provider = new SupabaseIdentityProvider(
      auth({
        verifyOtp: async (_email, _code, type) =>
          type === 'recovery' ? {} : { access_token: 't' },
        enrollTotp: async (_token, options) => {
          calls.push(options);
          return { id: 'f', totp: { qr_code: '<svg/>', secret: 'AAAA' } };
        },
      }),
      { issuer: 'Shop' },
    );
    await expect(
      provider.verify('a@example.com', '123456', 'recovery'),
    ).rejects.toMatchObject({ status: 400 });
    expect(await provider.verify('a@example.com', '123456', 'signup')).toEqual({
      access_token: 't',
    });
    expect(await provider.verifyEmailChange('a@example.com', '123456')).toEqual(
      { access_token: 't' },
    );
    await provider.enroll('t');
    expect(calls).toEqual([{ issuer: 'Shop' }]);
  });
});
