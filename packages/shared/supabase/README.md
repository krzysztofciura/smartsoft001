# 📦 @smartsoft001/supabase

![npm](https://img.shields.io/npm/v/@smartsoft001/supabase) ![downloads](https://img.shields.io/npm/dm/@smartsoft001/supabase)

The Supabase implementation of the storage contracts declared in [@smartsoft001/domain-core](../domain-core/README.md), the counterpart of [@smartsoft001/mongo](../mongo/README.md). One module import binds the abstract item repository, attachment repository and unit of work to the PostgreSQL database and the Storage of a Supabase project, and adds a server-side client of Supabase Auth. Application code keeps injecting the abstractions.

## 🚀 Usage

`npm i @smartsoft001/supabase pg`

```typescript
import { Module } from '@nestjs/common';
import { SupabaseModule } from '@smartsoft001/supabase';

@Module({
  imports: [
    SupabaseModule.forRoot({
      db: { connectionString: process.env.SUPABASE_DB_URL },
      url: process.env.SUPABASE_URL,
      serviceKey: process.env.SUPABASE_SERVICE_KEY,
      table: 'tasks',
      bucket: 'task-files',
    }),
  ],
})
export class DataModule {}
```

Create the table in a migration with `supabaseItemTableSql({ table: 'tasks' })` (see below). Every `forRoot` call has its own connection pool, opened on first use and closed with the Nest application; a second table means a second `forRoot` in the module that needs it.

## 🔌 What forRoot registers

The dynamic module both provides and exports these bindings.

<table>
    <thead>
        <tr>
            <td>Token</td>
            <td>Bound to</td>
        </tr>
    </thead>
    <tr><td>SupabaseConfig</td><td>the object passed to forRoot</td></tr>
    <tr><td>IItemRepository</td><td>SupabaseItemRepository</td></tr>
    <tr><td>IAttachmentRepository</td><td>SupabaseAttachmentRepository</td></tr>
    <tr><td>IUnitOfWork</td><td>SupabaseUnitOfWork</td></tr>
    <tr><td>SupabasePool</td><td>the connection pool of this forRoot</td></tr>
    <tr><td>SupabaseAuthService</td><td>Supabase Auth client</td></tr>
</table>

## ⚙️ SupabaseConfig

| Field | Meaning |
| --- | --- |
| `db.connectionString` | PostgreSQL URL of the project (direct or pooler). Credentials never appear in errors. |
| `db.ssl` | `true` (default) verifies the server certificate; `{ ca }` for a project certificate. TLS comes only from here, never from URL parameters. |
| `db.max`, `db.statementTimeout` | Pool size (default `5`) and `statement_timeout` in ms (default `15000`). |
| `table`, `schema` | Item table and its schema (default `public`). |
| `columns` | Top-level fields also stored in their own columns, e.g. `{ ownerId: 'owner_id' }`, for indexes, typed filters and row-level security policies. |
| `cipher` | `ISupabaseDocumentCipher`: the document is sealed into `envelope` (envelope encryption, bound to schema, table and id). Only `id` and `columns` can then be filtered or sorted; other fields are refused. |
| `context` | Runs right after `BEGIN` of every transaction the package opens, e.g. `set_config('app.tenant', …, true)` for row-level security. |
| `url`, `authUrl`, `storageUrl`, `anonKey`, `serviceKey` | Project URL (Auth at `/auth/v1`, Storage at `/storage/v1`, both overridable), public key for the gateway, server-only key for Storage. |
| `bucket` | Storage bucket of the attachment repository. |
| `changeLog` | Table for an audit row per write (`supabaseChangeLogTableSql`). Off by default: items can contain personal data. |
| `type` | Model class whose `@Field({ search: true })` fields answer `$search`. |

## 🛠️ Services & Methods

### SupabaseItemRepository

One row per item: `id` (text primary key), the document in `data` (jsonb) or `envelope` (text, with a `cipher`), `info` (jsonb: who created and last updated it, and when) and the declared columns. `id` lives in its column, never in the document.

- `create`, `createMany`, `update` (replace), `updatePartial` (top-level keys replace, like `$set`), `updatePartialManyByCriteria`/`BySpecification`, `delete`, `clear`.
- `compareAndSet(id, expected, set)`: one `UPDATE … WHERE id AND <expected>`; every expected value is compared with `$eq` (never read as an operator); returns whether the row matched.
- `getById`, `getByCriteria`, `getBySpecification`, `countByCriteria`, `countBySpecification`. Options: `sort`, `limit`, `skip`/`offset`, `project`/`fields`, `omit`; aggregation options (`group`, `min`, `max`) are refused.
- Criteria use the MongoDB syntax of the other repositories: implicit equality, `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$exists`, `$regex` (with `$options: 'i'`), `$and`, `$or`, `$nor`, dot paths and `$search`. Every value is a bound parameter; unknown operators (`$where`, `$expr`, …) and unsafe field names are refused. Equality with `null` also matches a missing field, and equality with a scalar also matches an array containing it, as in MongoDB. Regular expressions run as PostgreSQL POSIX expressions.
- `changesByCriteria({ id? })`: changes announced by the table trigger (`supabaseItemTableSql({ changes: true })`) through `LISTEN/NOTIFY`. Created and updated items are read back; an update carries the whole item in `updatedFields`. Each subscription holds one pooled connection.
- Writes run on the client of a `SupabaseUnitOfWork` scope when one is passed in `{ transaction }`, otherwise each call runs in a transaction of its own (with the `context` hook).

### SupabaseAttachmentRepository

Supabase Storage, one immutable object per attachment id in `bucket` (`x-upsert: false`), written with `serviceKey`; the file name is stored as object metadata. `getStream` honours a byte range. Ids are limited to `[A-Za-z0-9][A-Za-z0-9_.-]*`; a missing object gives `null` from `getInfo` and is ignored by `delete`. Errors (`SupabaseStorageError`) carry a status but never keys or response bodies.

### SupabaseUnitOfWork

`scope(async (transaction) => …)` runs on one client between `BEGIN` and `COMMIT`; any error rolls back and is rethrown. `transaction.connection` is that client. A client whose rollback fails is discarded instead of returned to the pool.

### SupabaseAuthService

Server-side client of Supabase Auth (GoTrue): `signInWithPassword`, `refresh`, `getUser`, `signUp` (refused before any account is created when the project would sign in without an e-mail confirmation; the same answer for new and existing addresses), `resetPasswordForEmail`, `verifyOtp` (`signup`, `recovery`, `email_change`, …; the first of the two secure e-mail-change codes returns no session), `updateUser` (password or e-mail), `signOut` (`local`, `global`, `others`) and TOTP factors (`enrollTotp`, `unenrollFactor`, `verifyTotp`). Only the configured endpoint is contacted, redirects are refused and answers are size-bounded. Errors are `SupabaseAuthError` with a coarse `code` (`invalid_credentials`, `too_many_attempts`, `confirmation_required`, `unavailable`); provider messages are not passed on.

## 🔧 Functions

- `supabaseItemTableSql({ schema?, table, columns?, encrypted?, changes? })`: DDL of an item table with forced row-level security (policies stay with the application), optional typed columns and the change trigger.
- `supabaseChangeLogTableSql({ schema?, table })`: DDL of the opt-in change log.
- `supabaseChangeChannel(schema, table)`: notification channel used by the trigger and `changesByCriteria`.
- `quoteIdentifier(name)`: quotes a plain lower-case SQL identifier, refusing anything else.
