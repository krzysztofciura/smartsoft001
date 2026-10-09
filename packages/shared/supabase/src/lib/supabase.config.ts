import type { PoolClient } from 'pg';

/**
 * Encrypts the stored document of an item (envelope encryption, e.g. a fresh
 * data key per row wrapped by a key kept outside the database). The context
 * binds the ciphertext to its row, so an envelope copied to another row or
 * table does not open.
 */
export interface ISupabaseDocumentCipher {
  seal(
    document: string,
    context: ISupabaseCipherContext,
  ): string | Promise<string>;
  open(
    envelope: string,
    context: ISupabaseCipherContext,
  ): string | Promise<string>;
}

export interface ISupabaseCipherContext {
  schema: string;
  table: string;
  id: string;
}

/** PostgreSQL connection of the Supabase project (direct or through the pooler). */
export interface ISupabaseDbConfig {
  /** `postgres://user:password@host:port/database`; credentials never appear in errors. */
  connectionString: string;
  /**
   * TLS for the connection. `true` verifies the server certificate against the
   * system roots; pass `{ ca }` for a project certificate. Default `true`.
   */
  ssl?: boolean | { ca?: string; rejectUnauthorized?: boolean };
  /** Pool size. Default `5`. */
  max?: number;
  /** `statement_timeout` in milliseconds for every connection. Default `15000`. */
  statementTimeout?: number;
}

/**
 * Settings of one Supabase-backed feature, registered by the host application
 * (`SupabaseModule.forRoot({ ... })`). The class is a DI token and a shape,
 * never constructed with values, hence the definite assignment.
 */
export class SupabaseConfig {
  /** Project URL, e.g. `https://<ref>.supabase.co`; Auth and Storage live under it. */
  url?: string;
  /** Auth endpoint override (default `<url>/auth/v1`), e.g. a private GoTrue address. */
  authUrl?: string;
  /** Storage endpoint override (default `<url>/storage/v1`). */
  storageUrl?: string;
  /** Public key sent as `apikey` to the Supabase gateway. */
  anonKey?: string;
  /** Server-only key for Storage (service role or a scoped JWT). Never sent to a browser. */
  serviceKey?: string;
  /** PostgreSQL connection for the item repository and the unit of work. */
  db?: ISupabaseDbConfig;
  /** Schema of the item table. Default `public`. */
  schema?: string;
  /** Item table of this feature (the counterpart of `MongoConfig.collection`). */
  table!: string;
  /**
   * Top-level document fields also kept in their own columns, e.g.
   * `{ ownerId: 'owner_id' }`: they can be indexed, filtered with a typed
   * comparison, referenced by row-level security policies and, with a
   * `cipher`, they are the only fields that can be filtered or sorted.
   */
  columns?: Record<string, string>;
  /** Encrypts the stored document; see `ISupabaseDocumentCipher`. */
  cipher?: ISupabaseDocumentCipher;
  /**
   * Runs right after `BEGIN` of every transaction the package opens, e.g.
   * `set_config('app.tenant', …, true)` for row-level security policies.
   */
  context?: (client: PoolClient) => Promise<void>;
  /** Writes `{ type, table, item, user, error, date }` to this table for every write. Off by default. */
  changeLog?: string;
  /** Storage bucket of the attachment repository. */
  bucket?: string;
  /** Model class whose `search` fields answer `$search` criteria. */
  type?: any;
}
