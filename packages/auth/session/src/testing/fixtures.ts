import { randomBytes, randomUUID } from 'crypto';

import { SessionConfig } from '../lib/session.config';
import { SessionService } from '../lib/session.service';
import { SessionTeamService } from '../lib/session.team';
import {
  IIdentityProvider,
  IIdentityTokens,
  IIdentityUser,
  ISessionSecurityState,
  ISessionStore,
  ISessionTeamAccount,
  ISessionTeamStore,
  ISessionTeamTransaction,
  ISessionTransaction,
  IStoredSession,
  SessionAccountEvent,
  SessionError,
  SessionTeamAction,
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

/** Team store over `MemorySessionStore` states and a list of accounts, with the rollback of `PgSessionTeamStore`. */
export class MemoryTeamStore extends ISessionTeamStore {
  events: {
    actor: string;
    subject: string;
    action: SessionTeamAction;
    role: string | null;
  }[] = [];

  /** Suspended members keep their role here while the runtime state shows none. */
  suspendedRoles = new Map<string, string>();

  constructor(
    private readonly sessions: MemorySessionStore,
    public accountList: ISessionTeamAccount[] = [],
    /** Forgets the provider's factors of a member whose authenticator is reset. */
    private readonly forgetFactors: (userId: string) => void = () => undefined,
  ) {
    super();
  }

  async ready(): Promise<void> {
    return;
  }

  async roles(): Promise<Map<string, string>> {
    return new Map([
      ...[...this.sessions.states]
        .filter(([, s]) => s.role)
        .map(([id, s]) => [id, s.role as string] as [string, string]),
      ...this.suspendedRoles,
    ]);
  }

  async members() {
    return [
      ...[...this.sessions.states]
        .filter(([, s]) => s.role)
        .map(([userId, s]) => ({
          userId,
          role: s.role as string,
          mfaBound: s.mfaBound,
          suspended: false,
        })),
      ...[...this.suspendedRoles].map(([userId, role]) => ({
        userId,
        role,
        mfaBound: this.sessions.states.get(userId)?.mfaBound ?? false,
        suspended: true,
      })),
    ];
  }

  async account(email: string): Promise<ISessionTeamAccount | null> {
    return (
      this.accountList.find((a) => a.email.toLowerCase() === email) ?? null
    );
  }

  async accounts(ids: string[]): Promise<ISessionTeamAccount[]> {
    return this.accountList.filter((a) => ids.includes(a.id));
  }

  async recent(days: number): Promise<ISessionTeamAccount[]> {
    const since = Date.now() - days * 86400000;
    return this.accountList
      .filter((a) => a.createdAt && Date.parse(a.createdAt) > since)
      .sort((a, b) => Date.parse(b.createdAt!) - Date.parse(a.createdAt!));
  }

  async change<T>(
    work: (tx: ISessionTeamTransaction) => Promise<T>,
  ): Promise<T> {
    const states = new Map(
      [...this.sessions.states].map(([id, s]) => [id, { ...s }]),
    );
    const sessions = new Map(this.sessions.sessions);
    const suspended = new Map(this.suspendedRoles);
    const events = this.events.length;
    const state = (id: string) => {
      const current = this.sessions.states.get(id) ?? {
        revokedBefore: 0,
        mfaBound: false,
        role: null,
        closing: false,
      };
      this.sessions.states.set(id, current);
      return current;
    };
    try {
      return await work({
        roles: () => this.roles(),
        set: async (id, role) => {
          if (this.suspendedRoles.has(id)) this.suspendedRoles.set(id, role);
          else state(id).role = role;
        },
        remove: async (id) => {
          state(id).role = null;
          this.suspendedRoles.delete(id);
        },
        suspended: async () => new Set(this.suspendedRoles.keys()),
        suspend: async (id, on) => {
          if (on) {
            const role = state(id).role;
            if (role) {
              this.suspendedRoles.set(id, role);
              state(id).role = null;
            }
          } else {
            const role = this.suspendedRoles.get(id);
            if (role) {
              state(id).role = role;
              this.suspendedRoles.delete(id);
            }
          }
        },
        resetMfa: async (id) => {
          state(id).mfaBound = false;
          this.forgetFactors(id);
        },
        revoke: async (id) => {
          state(id).revokedBefore = ++this.sessions.time;
          for (const [hash, row] of this.sessions.sessions)
            if (row.userId === id) this.sessions.sessions.delete(hash);
        },
        event: async (actor, subject, action, role) => {
          this.events.push({ actor, subject, action, role });
        },
      });
    } catch (error) {
      this.sessions.states = states;
      this.sessions.sessions = sessions;
      this.suspendedRoles = suspended;
      this.events.length = events;
      throw error;
    }
  }
}

/** An account of the team store: confirmed and created `daysAgo` days ago unless said otherwise. */
export function teamAccount(
  email: string,
  patch: Partial<ISessionTeamAccount> & { daysAgo?: number } = {},
): ISessionTeamAccount {
  const { daysAgo = 1, ...rest } = patch;
  return {
    id: randomUUID(),
    email,
    createdAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
    lastSignInAt: null,
    confirmed: true,
    ...rest,
  };
}

/**
 * A team: the provider's user is an owner with a bound authenticator, the
 * store knows that account plus a recent one (`candidate`) and an old one
 * (`veteran`); `ownerSession` opens an AAL2 session.
 */
export function teamSetup(patch: Partial<SessionConfig> = {}) {
  const setup = sessionSetup(patch);
  const { store, provider } = setup;
  const factor = randomUUID();
  provider.factors = [{ id: factor, factor_type: 'totp', status: 'verified' }];
  store.states.set(provider.id, {
    revokedBefore: 0,
    mfaBound: true,
    role: 'owner',
    closing: false,
  });
  const candidate = teamAccount('nowa@example.com', { daysAgo: 2 });
  const veteran = teamAccount('stala@example.com', { daysAgo: 400 });
  const teamStore = new MemoryTeamStore(
    store,
    [
      teamAccount(provider.email, {
        id: provider.id,
        daysAgo: 500,
        lastSignInAt: new Date().toISOString(),
      }),
      candidate,
      veteran,
    ],
    (id) => {
      if (id === provider.id) provider.factors = [];
    },
  );
  const team = new SessionTeamService(setup.service, teamStore, {
    permission: 'store:manage',
  });
  const ownerSession = async () => {
    const first = await setup.service.login(provider.email, provider.secret);
    return (await setup.service.mfa(first.cookie, factor, '123456')).cookie;
  };
  return {
    ...setup,
    teamStore,
    team,
    factor,
    candidate,
    veteran,
    ownerSession,
  };
}
