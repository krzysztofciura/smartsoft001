# @smartsoft001/auth-session

Server-side account sessions for NestJS, for a browser application served from the same origin as its API (backend-for-frontend). It is an alternative to the token model of `@smartsoft001/auth-shell-nestjs` when the browser must never hold a provider token.

- The browser holds only a random `HttpOnly`, `SameSite=Strict` cookie (`__Host-` prefixed on HTTPS). Its SHA-256 hash is the row key.
- The identity provider's access token stays on the server, sealed per row (AES-256-GCM with a fresh data key, bound to the table and row).
- Every request re-checks the user with the provider. Revocation is immediate: password change, e-mail change, account closure and "sign out everywhere" end every session, including one being created at that moment.
- Staff have a role (from a table the application cannot write) and act only with a TOTP-confirmed (AAL2) session; customers with a bound authenticator need AAL2 too.
- State-changing requests need the exact `Origin`, same-origin fetch metadata, a signed double-submit CSRF header and a JSON body of at most 8 KB.
- Attempts are rate-limited in the database by HMAC keys (per address, per user and action, per client address).
- Account self-service: data export, deletion request (sign-in refused until a host job deletes the account), e-mail change with a code from each mailbox. Events are recorded with a hash of the user id only.

## Installation

```bash
npm i @smartsoft001/auth-session @smartsoft001/supabase pg
```

## Usage

```typescript
import { Module } from '@nestjs/common';
import { RouterModule } from '@nestjs/core';
import { PgSessionStore, SessionModule, SupabaseIdentityProvider } from '@smartsoft001/auth-session';
import { SupabaseAuthService, SupabaseConfig } from '@smartsoft001/supabase';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.AUTH_DATABASE_URL });

@Module({
  imports: [
    SessionModule.forRoot({
      config: {
        origin: 'https://shop.example.com',
        key: Buffer.from(process.env.SESSION_KEY, 'hex'), // 32 random bytes, outside the database
        secure: true,
        mailEnabled: true,
        roles: { owner: ['store:manage', 'orders:read'], support: ['orders:read'] },
        schema: 'auth_session',
        issuer: 'Shop',
      },
      store: new PgSessionStore(pool, 'auth_session'),
      provider: new SupabaseIdentityProvider(new SupabaseAuthService({ authUrl: process.env.AUTH_URL } as SupabaseConfig), { issuer: 'Shop' }),
      exporter: async (customer) => ({ orders: await orders.forCustomer(customer.id) }),
    }),
    RouterModule.register([{ path: 'api/v1', module: SessionModule }]),
  ],
})
export class AppModule {}
```

Create the tables once with a migration: `sessionTablesSql({ schema: 'auth_session', runtimeRole: 'auth_session_runtime', roles: ['owner', 'support'] })`. Log in with a role that is a member of `runtimeRole` only and check it at start with `verifySessionRole(pool, { schema, runtimeRole })`. Staff roles are inserted into `<schema>.staff` by an administrator. Run `store.cleanup()` periodically.

Disable Nest's global body parser (`NestFactory.create(AppModule, { bodyParser: false })`): the module parses its own bodies with the 8 KB limit.

## Routes

Under the prefix given to `RouterModule` (`/api/v1` above):

| Route                                            | Purpose                                                                    |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| `GET auth/session`                               | The signed-in account (or `null`), the CSRF token and whether mail is on. Sets the CSRF cookie. |
| `POST auth/login`                                | Password sign-in; sets the session cookie.                                 |
| `POST auth/register`, `auth/recovery`            | Sign-up and recovery codes by e-mail (`mail_unavailable` without mail).    |
| `POST auth/verify`                               | A sign-up or recovery code; recovery opens a session that can only set a new password. |
| `POST auth/mfa/enroll`, `auth/mfa/verify`        | TOTP enrolment (QR as an inert SVG data URL) and verification (new AAL2 session). |
| `POST auth/password`                             | New password (the current one is required outside recovery); ends every session. |
| `POST auth/email`, `auth/email/verify`           | E-mail change with a code from the current and from the new mailbox.       |
| `POST auth/export`                               | The account and what `exporter` returns, as a download.                    |
| `POST auth/close`                                | Deletion request with the password.                                        |
| `POST auth/logout`, `auth/logout-all`            | Sign out here or everywhere.                                               |
| `GET admin/access`                               | Role and permissions of a staff member with an AAL2 session; 403 otherwise. |

POST requests send the header `X-Shop-CSRF` with the `csrf` value from `GET auth/session`. Failures answer `{ error, code, requestId }`; `messages` replaces the text of each code (for example a translation), `code` stays stable.

## Other modules

Inject `SessionService` and run the work inside the session:

```typescript
@Post('orders/:id/cancel')
cancel(@Req() req: Request, @Param('id') id: string) {
  requireSessionCsrf(req, this.sessions);
  return this.sessions.withAuthorization(requestSession(req, this.sessions), 'orders:write', (actor) =>
    this.orders.cancel(id, actor.id),
  );
}
```

`withAuthorization` (staff with a permission), `withCustomer` (a signed-in account) and `withDelegation` (work of a token issued by a staff member) run the work inside the user's transaction, so a revocation cannot happen half-way.

For controllers that only need to admit staff, `SessionGuard` checks the session (and CSRF for methods other than GET and HEAD) before the handler and sets `req.user` (`{ id, role, permissions }`, read with `@User()` from `@smartsoft001/nestjs`); `@SessionPermission('orders:read')` names the permission. Import `SessionModule` in the module of the controller.

```typescript
@Controller('reports')
@UseGuards(SessionGuard)
export class ReportsController {
  @Get()
  @SessionPermission('orders:read')
  list(@User() user: ISessionUser) {}
}
```

## Team

With `team`, holders of `permission` (with an AAL2 session and CSRF) manage who is staff under `admin/team`: `GET` lists the members and the confirmed accounts created in the last `candidateDays` days (default 30) that have no role yet, `POST grant` `{ email, role }` gives an existing account a role, `POST role` `{ id, role }` changes it and `POST remove` `{ id }` takes it away; on one member `{ id }`, `POST suspend` and `POST resume` freeze and restore the role (the account keeps working without it), `POST revoke` ends the sessions and `POST mfa-reset` forgets the authenticator (the bound flag and the provider's factors, `factors` table), so the next sign-in enrols a new one. An owner never acts on their own account here, and the last active owner cannot be suspended. Every change ends the person's sessions (and voids work delegated by them), the last owner can never be demoted or removed, accounts are never created or deleted here, and every change is recorded in `staff_events` with ids only. `SessionTeamService.bootstrap(email)` gives the first owner of an empty team a role from a host command.

Roles are written only by `PgSessionTeamStore` on its own login (`sessionTablesSql({ teamRole })` grants it the roles, the sessions it ends and `staff_events`; `verifyTeamRole` checks that login), while the session runtime keeps reading them (`verifySessionRole` still refuses a runtime that could write them). The store also reads the provider's accounts for the team screen: grant the team login SELECT on the columns `id`, `email`, `created_at`, `last_sign_in_at`, `email_confirmed_at`, `deleted_at`, `is_anonymous` of `auth.users` (or name another table with `identities`). The roles may live in a schema of their own (`schema`) next to the session tables (`sessions`).

```typescript
SessionModule.forRoot({
  service,
  team: {
    permission: 'store:manage',
    store: new PgSessionTeamStore(teamPool, { schema: 'shop_staff', sessions: 'shop_auth', identities: 'auth.users' }),
  },
});
```

## Other identity providers

Implement `IIdentityProvider` (password sign-in, user by token, e-mail codes, password and e-mail change, sign-out, TOTP) and pass it as `provider`. `ISessionStore` can likewise be replaced; `PgSessionStore` documents the required semantics.
