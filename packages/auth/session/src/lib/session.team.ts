import { Inject, Injectable } from '@nestjs/common';

import { ISessionActor, SessionService } from './session.service';
import {
  ISessionTeamAccount,
  ISessionTeamStore,
  SessionError,
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
}

/**
 * The team of staff: an owner gives an existing, confirmed account a role
 * (picked from the accounts created recently or named by its exact address),
 * changes it or removes it. Every change ends the person's sessions and voids
 * work delegated by them; the team never loses its last owner. Roles are
 * written through `ISessionTeamStore` (a login separate from the session
 * runtime; accounts themselves are never created or deleted here) and every
 * change is recorded with ids only.
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
      if (current === this.owner && this.owners(roles) === 1)
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
      if (current === this.owner && this.owners(roles) === 1)
        throw new SessionError(409, 'last_owner');
      await tx.remove(id);
      await tx.revoke(id);
      await tx.event(actor.id, id, 'remove', null);
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

  private owners(roles: Map<string, string>): number {
    return [...roles.values()].filter((r) => r === this.owner).length;
  }
}
