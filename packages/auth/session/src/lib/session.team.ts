import { Inject, Injectable } from '@nestjs/common';

import { ISessionActor, SessionService } from './session.service';
import {
  ISessionTeamAccount,
  ISessionTeamStore,
  ISessionTeamTransaction,
  SessionError,
  SessionTeamAction,
} from './session.types';

/** Settings of team management. */
export class SessionTeamOptions {
  /** Permission that manages the team (e.g. `store:manage`); the session must also be AAL2. */
  permission!: string;
  /** Role that never disappears from the team. Default `owner`. */
  ownerRole?: string;
  /** How many days back the candidate list (accounts without a role) reaches. Default 30. */
  candidateDays?: number;
}

/** A team member as the managing owner sees them. */
export interface ISessionTeamMember {
  id: string;
  email: string;
  role: string;
  createdAt: string | null;
  lastSignInAt: string | null;
  /** Bound an authenticator (TOTP) at least once. */
  authenticator: boolean;
  /** The signed-in owner themselves. */
  self: boolean;
  /** Role suspended by an owner: no panel until it is resumed; the account itself keeps working. */
  suspended: boolean;
}

/**
 * The team of staff: an owner gives an existing, confirmed account a role
 * (picked from the accounts created recently or named by its exact address),
 * changes it or removes it. Every change ends the person's sessions and voids
 * work delegated by them; the team never loses its last owner. Roles are
 * written through `ISessionTeamStore` (a login separate from the session
 * runtime; accounts themselves are never created or deleted here) and every
 * change is recorded with ids only. An owner can also suspend and resume a
 * member's role, end their sessions or force a new authenticator (`resetMfa`),
 * never on their own account.
 */
@Injectable()
export class SessionTeamService {
  constructor(
    @Inject(SessionService) private readonly session: SessionService,
    @Inject(ISessionTeamStore) private readonly store: ISessionTeamStore,
    @Inject(SessionTeamOptions) private readonly options: SessionTeamOptions,
  ) {}

  private get owner(): string {
    return this.options.ownerRole ?? 'owner';
  }

  /** Members, and the confirmed accounts created recently that could join. */
  async list(cookie: string): Promise<{
    members: ISessionTeamMember[];
    candidates: ISessionTeamAccount[];
  }> {
    const actor = await this.authorize(cookie);
    const members = await this.store.members();
    const [accounts, recent] = await Promise.all([
      this.store.accounts(members.map((m) => m.userId)),
      this.store.recent(this.options.candidateDays ?? 30),
    ]);
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const roles = new Set(members.map((m) => m.userId));
    return {
      members: members
        .map((m) => {
          const a = byId.get(m.userId);
          return {
            id: m.userId,
            email: a?.email ?? '',
            role: m.role,
            createdAt: a?.createdAt ?? null,
            lastSignInAt: a?.lastSignInAt ?? null,
            authenticator: m.mfaBound,
            self: m.userId === actor.id,
            suspended: m.suspended,
          };
        })
        .sort((a, b) => a.email.localeCompare(b.email)),
      candidates: recent.filter((a) => a.confirmed && !roles.has(a.id)),
    };
  }

  /** A role for an existing, confirmed account; the person signs in again and binds an authenticator. */
  async grant(
    cookie: string,
    email: string,
    role: string,
  ): Promise<{ id: string }> {
    const actor = await this.authorize(cookie);
    this.role(role);
    await this.session.limit('team:' + actor.id, 30, 3600000);
    return this.add(actor.id, email, role, false);
  }

  /**
   * The first owner of a team without one, from a host command (no session
   * yet). Refused once the team has an owner: everyone else joins through
   * the panel.
   */
  async bootstrap(email: string): Promise<{ id: string }> {
    return this.add(null, email, this.owner, true);
  }

  async setRole(cookie: string, id: string, role: string): Promise<void> {
    const actor = await this.authorize(cookie);
    this.role(role);
    await this.store.change(async (tx) => {
      const roles = await tx.roles();
      const current = roles.get(id);
      if (!current) throw new SessionError(404, 'not_found');
      if (current === role) return;
      if (
        current === this.owner &&
        this.owners(roles, await tx.suspended()) === 1
      )
        throw new SessionError(409, 'last_owner');
      await tx.set(id, role);
      await tx.revoke(id);
      await tx.event(actor.id, id, 'role', role);
    });
  }

  /** Removes the role and ends the sessions; the account itself stays the person's own. */
  async remove(cookie: string, id: string): Promise<void> {
    const actor = await this.authorize(cookie);
    await this.store.change(async (tx) => {
      const roles = await tx.roles();
      const current = roles.get(id);
      if (!current) throw new SessionError(404, 'not_found');
      if (
        current === this.owner &&
        this.owners(roles, await tx.suspended()) === 1
      )
        throw new SessionError(409, 'last_owner');
      await tx.remove(id);
      await tx.revoke(id);
      await tx.event(actor.id, id, 'remove', null);
    });
  }

  /**
   * Suspends the member's role: the panel closes at once and the account keeps
   * working without a role until `resume`. The last active owner cannot be
   * suspended. Repeating it changes nothing.
   */
  async suspend(cookie: string, id: string): Promise<void> {
    await this.act(cookie, id, 'suspend', async (tx, roles, suspended) => {
      if (suspended.has(id)) return false;
      if (roles.get(id) === this.owner && this.owners(roles, suspended) === 1)
        throw new SessionError(409, 'last_owner');
      await tx.suspend(id, true);
      return true;
    });
  }

  /** Restores a suspended role; the person signs in again. */
  async resume(cookie: string, id: string): Promise<void> {
    await this.act(cookie, id, 'resume', async (tx, _roles, suspended) => {
      if (!suspended.has(id)) return false;
      await tx.suspend(id, false);
      return true;
    });
  }

  /** Ends every session of the member on every device; the role stays. */
  async revoke(cookie: string, id: string): Promise<void> {
    await this.act(cookie, id, 'revoke', async () => true);
  }

  /**
   * Forces a new authenticator: the bound flag and the provider's factors are
   * forgotten, every session ends, and the next sign-in has to enrol a new
   * TOTP app before the role applies (a lost or compromised phone).
   */
  async resetMfa(cookie: string, id: string): Promise<void> {
    await this.act(cookie, id, 'mfa_reset', async (tx) => {
      await tx.resetMfa(id);
      return true;
    });
  }

  /**
   * One change of one member by the managing owner: never their own account
   * (that is the account page's job), only members, and every change ends the
   * member's sessions and is recorded. `work` returns false when nothing changed.
   */
  private async act(
    cookie: string,
    id: string,
    action: SessionTeamAction,
    work: (
      tx: ISessionTeamTransaction,
      roles: Map<string, string>,
      suspended: Set<string>,
    ) => Promise<boolean>,
  ): Promise<void> {
    const actor = await this.authorize(cookie);
    if (actor.id === id) throw new SessionError(409, 'own_account');
    await this.store.change(async (tx) => {
      const roles = await tx.roles();
      if (!roles.has(id)) throw new SessionError(404, 'not_found');
      if (!(await work(tx, roles, await tx.suspended()))) return;
      await tx.revoke(id);
      await tx.event(actor.id, id, action, roles.get(id) ?? null);
    });
  }

  private async add(
    actor: string | null,
    email: string,
    role: string,
    bootstrap: boolean,
  ): Promise<{ id: string }> {
    const account = await this.store.account(email);
    if (!account) throw new SessionError(404, 'not_found');
    if (!account.confirmed) throw new SessionError(409, 'unconfirmed');
    await this.store.change(async (tx) => {
      const roles = await tx.roles();
      if (roles.has(account.id) || (bootstrap && this.owners(roles) > 0))
        throw new SessionError(409, 'staff_exists');
      await tx.set(account.id, role);
      await tx.revoke(account.id);
      await tx.event(actor ?? account.id, account.id, 'grant', role);
    });
    return { id: account.id };
  }

  private authorize(cookie: string): Promise<ISessionActor> {
    return this.session.withAuthorization(
      cookie,
      this.options.permission,
      async (actor) => actor,
    );
  }

  private role(role: string): void {
    if (!this.session.config.roles?.[role])
      throw new SessionError(400, 'invalid_input');
  }

  /** Owners able to act: a suspended owner does not count, so the team never locks itself out. */
  private owners(
    roles: Map<string, string>,
    suspended: Set<string> = new Set(),
  ): number {
    return [...roles].filter(
      ([id, r]) => r === this.owner && !suspended.has(id),
    ).length;
  }
}
