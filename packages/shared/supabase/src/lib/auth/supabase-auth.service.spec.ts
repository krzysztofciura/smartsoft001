import { SupabaseConfig } from '../supabase.config';
import {
  SupabaseAuthError,
  SupabaseAuthService,
} from './supabase-auth.service';

const config = {
  table: 'x',
  url: 'https://ref.supabase.co',
  anonKey: 'anon',
} as SupabaseConfig;

function respond(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
  });
}

describe('shared-supabase: SupabaseAuthService', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('should sign in with a password against the configured Auth endpoint only', async () => {
    // Arrange
    fetchMock.mockResolvedValue(respond(200, { access_token: 'jwt' }));
    const service = new SupabaseAuthService(config);

    // Act
    const session = await service.signInWithPassword('a@example.com', 'secret');

    // Assert
    expect(session.access_token).toBe('jwt');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://ref.supabase.co/auth/v1/token?grant_type=password',
    );
    expect(init.redirect).toBe('error');
    expect(init.headers).toMatchObject({ apikey: 'anon' });
    expect(JSON.parse(init.body)).toEqual({
      email: 'a@example.com',
      password: 'secret',
    });
  });

  it('should use an explicit Auth URL and send the access token for user calls', async () => {
    // Arrange
    fetchMock.mockResolvedValue(
      respond(200, { id: 'u1', email: 'a@example.com' }),
    );
    const service = new SupabaseAuthService({
      ...config,
      authUrl: 'http://auth:9999/',
    } as SupabaseConfig);

    // Act
    await service.getUser('jwt');

    // Assert
    expect(fetchMock.mock.calls[0][0]).toBe('http://auth:9999/user');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer jwt');
  });

  it.each([
    [400, 400, 'invalid_credentials'],
    [403, 400, 'invalid_credentials'],
    [429, 429, 'too_many_attempts'],
    [502, 503, 'unavailable'],
  ])(
    'should map status %i to %i %s without the response body',
    async (status, mapped, code) => {
      // Arrange
      fetchMock.mockResolvedValue(
        respond(status, { msg: 'detail with secret' }),
      );
      const service = new SupabaseAuthService(config);

      // Act
      const error = await service
        .signInWithPassword('a@example.com', 'wrong')
        .catch((e) => e);

      // Assert
      expect(error).toBeInstanceOf(SupabaseAuthError);
      expect([error.status, error.code]).toEqual([mapped, code]);
      expect(error.message).not.toContain('secret');
    },
  );

  it('should treat a network failure and an oversized answer as unavailable', async () => {
    // Arrange
    fetchMock
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(respond(200, { pad: 'x'.repeat(200000) }));
    const service = new SupabaseAuthService(config);

    // Act
    const offline = await service.getUser('jwt').catch((e) => e);
    const oversized = await service.getUser('jwt').catch((e) => e);

    // Assert
    expect(offline.code).toBe('unavailable');
    expect(oversized.code).toBe('unavailable');
  });

  it('should refuse a sign-up the project would not confirm by e-mail, before creating it', async () => {
    // Arrange
    fetchMock.mockResolvedValue(
      respond(200, {
        mailer_autoconfirm: true,
        disable_signup: false,
        external: { email: true },
      }),
    );
    const service = new SupabaseAuthService(config);

    // Act
    const error = await service
      .signUp('a@example.com', 'long password 1!')
      .catch((e) => e);

    // Assert
    expect(error.code).toBe('confirmation_required');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should answer a sign-up and a recovery the same for an existing address', async () => {
    // Arrange
    fetchMock
      .mockResolvedValueOnce(
        respond(200, {
          mailer_autoconfirm: false,
          disable_signup: false,
          external: { email: true },
        }),
      )
      .mockResolvedValueOnce(respond(400, { msg: 'User already registered' }))
      .mockResolvedValueOnce(respond(400, { msg: 'unknown user' }));
    const service = new SupabaseAuthService(config);

    // Act & Assert
    await expect(
      service.signUp('a@example.com', 'long password 1!'),
    ).resolves.toBeUndefined();
    await expect(
      service.resetPasswordForEmail('a@example.com'),
    ).resolves.toBeUndefined();
  });

  it('should acknowledge the first code of a secure e-mail change without a session', async () => {
    // Arrange
    fetchMock
      .mockResolvedValueOnce(
        respond(200, { msg: 'Confirmation link accepted' }),
      )
      .mockResolvedValueOnce(respond(200, { access_token: 'jwt2' }));
    const service = new SupabaseAuthService(config);

    // Act
    const first = await service.verifyOtp(
      'old@example.com',
      '111111',
      'email_change',
    );
    const second = await service.verifyOtp(
      'new@example.com',
      '222222',
      'email_change',
    );

    // Assert
    expect(first.access_token).toBeUndefined();
    expect(second.access_token).toBe('jwt2');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      email: 'old@example.com',
      token: '111111',
      type: 'email_change',
    });
  });

  it('should verify a TOTP code with one challenge', async () => {
    // Arrange
    fetchMock
      .mockResolvedValueOnce(respond(200, { id: 'ch1' }))
      .mockResolvedValueOnce(respond(200, { access_token: 'aal2' }));
    const service = new SupabaseAuthService(config);

    // Act
    const session = await service.verifyTotp('jwt', 'f/1', '123456');

    // Assert
    expect(session.access_token).toBe('aal2');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://ref.supabase.co/auth/v1/factors/f%2F1/challenge',
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      challenge_id: 'ch1',
      code: '123456',
    });
  });
});
