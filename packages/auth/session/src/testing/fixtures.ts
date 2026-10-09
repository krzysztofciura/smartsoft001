import { randomBytes, randomUUID } from 'crypto';

import { SessionConfig } from '../lib/session.config';
import { SessionService } from '../lib/session.service';
import {
  IIdentityProvider,
  IIdentityTokens,
  IIdentityUser,
  ISessionSecurityState,
  ISessionStore,
  ISessionTransaction,
  IStoredSession,
  SessionAccountEvent,
  SessionError,
} from '../lib/session.types';

/** In-memory store with the semantics of `PgSessionStore`. */
export class MemorySessionStore extends ISessionStore {
  sessions = new Map<string, IStoredSession & { expires: number }>();
  states = new Map<string, ISessionSecurityState>();
  attempts = new Map<string, number>();
  events: { marker: string; kind: SessionAccountEvent }[] = [];
  time = Date.now();

  async ready(): Promise<void> {
    return;
  }

  async cleanup(): Promise<void> {
    return;
  }

  async now(): Promise<number> {
    return ++this.time;
  }

  async read(hash: string): Promise<IStoredSession | null> {
    const row = this.sessions.get(hash);
    return row && row.expires > Date.now() ? row : null;
  }

  async attempt(key: string, limit: number): Promise<boolean> {
    const count = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, count);
    return count <= limit;
  }

  async user<T>(
    id: string,
    work: (tx: ISessionTransaction) => Promise<T>,
  ): Promise<T> {
    const state = this.states.get(id) ?? {
      revokedBefore: 0,
      mfaBound: false,
      role: null,
      closing: false,
    };
    this.states.set(id, state);
    return work({
      state: async () => state,
      read: (hash) => this.read(hash),
      save: async (hash, s, envelope) => {
        this.sessions.set(hash, { userId: id, envelope, expires: s.expires });
      },
      remove: async (hash) => {
        this.sessions.delete(hash);
      },
      revoke: async () => {
        state.revokedBefore = ++this.time;
        for (const [hash, row] of this.sessions)
          if (row.userId === id) this.sessions.delete(hash);
      },
      bindMfa: async () => {
        state.mfaBound = true;
      },
      close: async () => {
        state.closing = true;
      },
      event: async (marker, kind) => {
        this.events.push({ marker, kind });
      },
    });
  }
}

/** Identity provider with one user, unsigned JWT-shaped tokens and TOTP code `123456`. */
export class FakeIdentityProvider extends IIdentityProvider {
  id = randomUUID();
  email = 'session-test@example.com';
  secret = 'Existing password 1!';
  factors: { id: string; factor_type: string; status: string }[] = [];
  tokens = new Set<string>();
  recoveryUsed = false;
  pendingEmail: string | null = null;
  emailCodes: Partial<Record<'current' | 'new', string>> = {};
  emailConfirmed = 0;

  issue(aal = 'aal1'): IIdentityTokens {
    const claims = {
      sub: this.id,
      role: 'authenticated',
      aal,
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce: randomUUID(),
    };
    const token =
      'eyJhbGciOiJub25lIn0.' +
      Buffer.from(JSON.stringify(claims)).toString('base64url') +
      '.fixture';
    this.tokens.add(token);
    return { access_token: token };
  }

  async login(email: string, password: string): Promise<IIdentityTokens> {
    if (email !== this.email || password !== this.secret)
      throw new SessionError(400, 'invalid_credentials');
    return this.issue();
  }

  async user(token: string): Promise<IIdentityUser> {
    if (!this.tokens.has(token))
      throw new SessionError(401, 'invalid_credentials');
    return {
      id: this.id,
      email: this.email,
      email_confirmed_at: new Date().toISOString(),
      factors: structuredClone(this.factors),
    };
  }

  async signup(): Promise<void> {
    return;
  }

  async recover(): Promise<void> {
    return;
  }

  async verify(_email: string, code: string): Promise<IIdentityTokens> {
    if (code !== '123456' || this.recoveryUsed)
      throw new SessionError(400, 'invalid_credentials');
    this.recoveryUsed = true;
    return this.issue();
  }

  async changeEmail(token: string, email: string): Promise<void> {
    await this.user(token);
    this.pendingEmail = email;
    this.emailCodes = { current: '111111', new: '222222' };
    this.emailConfirmed = 0;
  }

  async verifyEmailChange(
    email: string,
    code: string,
  ): Promise<Partial<IIdentityTokens>> {
    const which =
      email === this.email && code === this.emailCodes.current
        ? 'current'
        : email === this.pendingEmail && code === this.emailCodes.new
          ? 'new'
          : null;
    if (!which) throw new SessionError(400, 'invalid_credentials');
    delete this.emailCodes[which];
    if (++this.emailConfirmed < 2) return {};
    this.email = this.pendingEmail as string;
    this.pendingEmail = null;
    return this.issue();
  }

  async password(token: string, password: string): Promise<void> {
    await this.user(token);
    this.secret = password;
  }

  async logout(token: string, scope: 'local' | 'global'): Promise<void> {
    if (scope === 'global') this.tokens.clear();
    else this.tokens.delete(token);
  }

  async enroll(): Promise<{
    id: string;
    totp: { qr_code: string; secret: string };
  }> {
    const id = randomUUID();
    this.factors.push({ id, factor_type: 'totp', status: 'unverified' });
    return { id, totp: { secret: 'AAAA', qr_code: '<svg></svg>' } };
  }

  async removePending(_token: string, id: string): Promise<void> {
    this.factors = this.factors.filter((f) => f.id !== id);
  }

  async mfa(
    _token: string,
    id: string,
    code: string,
  ): Promise<IIdentityTokens> {
    if (code !== '123456') throw new SessionError(400, 'invalid_credentials');
    const factor = this.factors.find((f) => f.id === id);
    if (factor) factor.status = 'verified';
    return this.issue('aal2');
  }
}

export const ROLES = {
  owner: ['store:manage', 'orders:read', 'orders:write', 'content:write'],
  orders: ['orders:read', 'orders:write'],
  content: ['content:write'],
};

export function sessionSetup(patch: Partial<SessionConfig> = {}) {
  const store = new MemorySessionStore();
  const provider = new FakeIdentityProvider();
  const config: SessionConfig = {
    origin: 'http://127.0.0.1:4300',
    key: randomBytes(32),
    secure: false,
    mailEnabled: false,
    roles: ROLES,
    ...patch,
  };
  const service = new SessionService(config, store, provider);
  return { store, provider, config, service };
}
