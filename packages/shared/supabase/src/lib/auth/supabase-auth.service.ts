import { Injectable } from '@nestjs/common';

import { SupabaseConfig } from '../supabase.config';

/** A Supabase Auth user as returned by `GET /user`. */
export interface ISupabaseAuthUser {
  id: string;
  email: string;
  email_confirmed_at?: string;
  created_at?: string;
  last_sign_in_at?: string;
  factors?: { id: string; factor_type: string; status: string }[];
}

/** Tokens of a session; `access_token` is a JWT with `sub`, `aal`, `exp`, `role`. */
export interface ISupabaseAuthSession {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  user?: ISupabaseAuthUser;
}

export type SupabaseOtpType =
  'signup' | 'recovery' | 'email_change' | 'magiclink' | 'email';

/**
 * A failed Auth call. `code` is one of `invalid_credentials` (any 4xx: wrong
 * password, code or token — deliberately not more specific), `too_many_attempts`
 * (429), `confirmation_required` (sign-up would create a session without an
 * e-mail confirmation) or `unavailable` (network, timeout, 5xx, malformed answer).
 * Messages never contain request bodies, tokens or keys.
 */
export class SupabaseAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code:
      | 'invalid_credentials'
      | 'too_many_attempts'
      | 'confirmation_required'
      | 'unavailable',
  ) {
    super(code);
  }
}

const TIMEOUT = 8000;
const MAX_RESPONSE = 131072;

/**
 * Server-side client of Supabase Auth (GoTrue): passwords, sign-up and e-mail
 * codes, recovery, users, password and e-mail changes, sign-out and TOTP
 * factors. Only the configured Auth endpoint is contacted, redirects are
 * refused and responses are size-bounded. Tokens are passed in by the caller
 * and never stored here.
 */
@Injectable()
export class SupabaseAuthService {
  constructor(protected readonly config: SupabaseConfig) {}

  signInWithPassword(
    email: string,
    password: string,
  ): Promise<ISupabaseAuthSession> {
    return this.request('/token?grant_type=password', 'POST', {
      email,
      password,
    });
  }

  /** New session from a refresh token (the old refresh token is consumed). */
  refresh(refreshToken: string): Promise<ISupabaseAuthSession> {
    return this.request('/token?grant_type=refresh_token', 'POST', {
      refresh_token: refreshToken,
    });
  }

  getUser(accessToken: string): Promise<ISupabaseAuthUser> {
    return this.request('/user', 'GET', undefined, accessToken);
  }

  /**
   * Starts a sign-up that must be confirmed by e-mail. Refuses (before any
   * account is created) when the project would sign the user in without a
   * confirmation, and answers the same way for a new and an existing address.
   */
  async signUp(email: string, password: string): Promise<void> {
    const settings = await this.request<{
      mailer_autoconfirm?: boolean;
      disable_signup?: boolean;
      external?: { email?: boolean };
    }>('/settings', 'GET');
    if (
      settings.mailer_autoconfirm !== false ||
      settings.disable_signup !== false ||
      settings.external?.email !== true
    )
      throw new SupabaseAuthError(503, 'confirmation_required');
    try {
      const result = await this.request<Partial<ISupabaseAuthSession>>(
        '/signup',
        'POST',
        { email, password },
      );
      if (result?.access_token) {
        await this.signOut(result.access_token, 'local').catch(() => undefined);
        throw new SupabaseAuthError(503, 'confirmation_required');
      }
    } catch (error) {
      if (!(error instanceof SupabaseAuthError) || error.status !== 400)
        throw error;
    }
  }

  /** Sends a recovery code; the answer is the same whether or not the address has an account. */
  async resetPasswordForEmail(email: string): Promise<void> {
    try {
      await this.request('/recover', 'POST', { email });
    } catch (error) {
      if (!(error instanceof SupabaseAuthError) || error.status !== 400)
        throw error;
    }
  }

  /**
   * Checks an e-mail code. For `email_change` with secure changes on, the
   * first of the two codes is only acknowledged (no `access_token`).
   */
  async verifyOtp(
    email: string,
    token: string,
    type: SupabaseOtpType,
  ): Promise<Partial<ISupabaseAuthSession>> {
    return (
      (await this.request<Partial<ISupabaseAuthSession>>('/verify', 'POST', {
        email,
        token,
        type,
      })) ?? {}
    );
  }

  /** Changes the password or starts an e-mail change (codes go to both mailboxes when secure changes are on). */
  async updateUser(
    accessToken: string,
    changes: { password?: string; email?: string },
  ): Promise<void> {
    await this.request('/user', 'PUT', changes, accessToken);
  }

  async signOut(
    accessToken: string,
    scope: 'local' | 'global' | 'others',
  ): Promise<void> {
    await this.request(
      '/logout?scope=' + scope,
      'POST',
      undefined,
      accessToken,
    );
  }

  /** New, unverified TOTP factor. The QR code is an SVG document: show it only as an image. */
  enrollTotp(
    accessToken: string,
    options: { issuer: string; friendlyName?: string },
  ): Promise<{
    id: string;
    totp: { qr_code: string; secret: string; uri?: string };
  }> {
    // The SVG QR code has one rectangle per module; observed answers exceed 400 KB.
    return this.request(
      '/factors',
      'POST',
      {
        factor_type: 'totp',
        friendly_name: options.friendlyName ?? 'Authenticator',
        issuer: options.issuer,
      },
      accessToken,
      1048576,
    );
  }

  async unenrollFactor(accessToken: string, factorId: string): Promise<void> {
    await this.request(
      '/factors/' + encodeURIComponent(factorId),
      'DELETE',
      undefined,
      accessToken,
    );
  }

  /** Challenge and verify in one step; a correct code returns an AAL2 session. */
  async verifyTotp(
    accessToken: string,
    factorId: string,
    code: string,
  ): Promise<ISupabaseAuthSession> {
    const factor = encodeURIComponent(factorId);
    const challenge = await this.request<{ id: string }>(
      '/factors/' + factor + '/challenge',
      'POST',
      {},
      accessToken,
    );
    return this.request(
      '/factors/' + factor + '/verify',
      'POST',
      { challenge_id: challenge.id, code },
      accessToken,
    );
  }

  protected get baseUrl(): string {
    const base =
      this.config.authUrl ??
      (this.config.url ? `${this.config.url.replace(/\/$/, '')}/auth/v1` : '');
    if (!base) throw new SupabaseAuthError(503, 'unavailable');
    return base.replace(/\/$/, '');
  }

  protected async request<R>(
    path: string,
    method: string,
    body?: unknown,
    token?: string,
    maxBytes = MAX_RESPONSE,
  ): Promise<R> {
    let response: Response;
    try {
      response = await fetch(this.baseUrl + path, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT),
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.anonKey ? { apikey: this.config.anonKey } : {}),
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new SupabaseAuthError(503, 'unavailable');
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429)
        throw new SupabaseAuthError(429, 'too_many_attempts');
      throw response.status >= 500
        ? new SupabaseAuthError(503, 'unavailable')
        : new SupabaseAuthError(400, 'invalid_credentials');
    }
    // Bound the allocation while streaming, also without Content-Length.
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      if (reader)
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > maxBytes) {
            await reader.cancel();
            throw new Error('Response limit');
          }
          chunks.push(chunk.value);
        }
      const text = Buffer.concat(chunks, size).toString('utf8');
      return (text ? JSON.parse(text) : undefined) as R;
    } catch {
      throw new SupabaseAuthError(503, 'unavailable');
    } finally {
      reader?.releaseLock();
    }
  }
}
