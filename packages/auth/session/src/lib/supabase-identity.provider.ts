import { Injectable } from '@nestjs/common';

import { SupabaseAuthError, SupabaseAuthService } from '@smartsoft001/supabase';

import {
  IdentityOtpType,
  IIdentityProvider,
  IIdentityTokens,
  IIdentityUser,
  SessionError,
} from './session.types';

/**
 * `IIdentityProvider` on Supabase Auth (`SupabaseAuthService` from
 * `@smartsoft001/supabase`). Provider failures become `SessionError` with the
 * same status and code; provider messages never reach the client.
 */
@Injectable()
export class SupabaseIdentityProvider extends IIdentityProvider {
  constructor(
    private readonly auth: SupabaseAuthService,
    private readonly options: { issuer?: string } = {},
  ) {
    super();
  }

  login(email: string, password: string): Promise<IIdentityTokens> {
    return this.call(() => this.auth.signInWithPassword(email, password));
  }

  user(token: string): Promise<IIdentityUser> {
    return this.call(() => this.auth.getUser(token));
  }

  signup(email: string, password: string): Promise<void> {
    return this.call(() => this.auth.signUp(email, password));
  }

  recover(email: string): Promise<void> {
    return this.call(() => this.auth.resetPasswordForEmail(email));
  }

  async verify(
    email: string,
    code: string,
    type: IdentityOtpType,
  ): Promise<IIdentityTokens> {
    const result = await this.call(() =>
      this.auth.verifyOtp(email, code, type),
    );
    if (!result.access_token)
      throw new SessionError(400, 'invalid_credentials');
    return result as IIdentityTokens;
  }

  verifyEmailChange(
    email: string,
    code: string,
  ): Promise<Partial<IIdentityTokens>> {
    return this.call(() => this.auth.verifyOtp(email, code, 'email_change'));
  }

  changeEmail(token: string, email: string): Promise<void> {
    return this.call(() => this.auth.updateUser(token, { email }));
  }

  password(token: string, password: string): Promise<void> {
    return this.call(() => this.auth.updateUser(token, { password }));
  }

  logout(token: string, scope: 'local' | 'global'): Promise<void> {
    return this.call(() => this.auth.signOut(token, scope));
  }

  enroll(
    token: string,
  ): Promise<{ id: string; totp: { qr_code: string; secret: string } }> {
    return this.call(() =>
      this.auth.enrollTotp(token, {
        issuer: this.options.issuer ?? 'Smartsoft',
      }),
    );
  }

  removePending(token: string, factor: string): Promise<void> {
    return this.call(() => this.auth.unenrollFactor(token, factor));
  }

  mfa(token: string, factor: string, code: string): Promise<IIdentityTokens> {
    return this.call(() => this.auth.verifyTotp(token, factor, code));
  }

  private async call<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof SupabaseAuthError)
        throw new SessionError(error.status, error.code);
      throw error;
    }
  }
}
