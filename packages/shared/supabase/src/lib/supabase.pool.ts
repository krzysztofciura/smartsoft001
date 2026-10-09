import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

import { quoteIdentifier } from './repositories/criteria';
import { SupabaseConfig } from './supabase.config';

/**
 * One connection pool per `SupabaseModule.forRoot` call, shared by its
 * repositories and unit of work and closed with the Nest application, or a
 * pool of the application (`db.pool`), which it then neither configures nor
 * closes.
 * Unlike `MongoItemRepository`, which connects per operation, PostgreSQL
 * connections are reused.
 */
@Injectable()
export class SupabasePool implements OnModuleDestroy {
  private pool?: Pool;

  constructor(private readonly config: SupabaseConfig) {}

  get schema(): string {
    return this.config.schema ?? 'public';
  }

  /** `"schema"."table"`, validated. */
  get table(): string {
    return `${quoteIdentifier(this.schema)}.${quoteIdentifier(this.config.table)}`;
  }

  /** A checked-out client; the caller releases it. */
  async connect(): Promise<PoolClient> {
    return this.getPool().connect();
  }

  /**
   * Runs `work` in its own transaction on one client: `BEGIN`, the configured
   * context hook, the work, `COMMIT`; any error rolls back. A client whose
   * rollback fails is discarded instead of returned to the pool.
   */
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.connect();
    let discard = false;
    try {
      await client.query('BEGIN');
      await this.config.context?.(client);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        discard = true;
      }
      throw error;
    } finally {
      client.release(discard);
    }
  }

  async onModuleDestroy(): Promise<void> {
    const pool = this.pool;
    this.pool = undefined;
    // A pool given by the application stays open: it may serve other features.
    if (pool && pool !== this.config.db?.pool) await pool.end();
  }

  private getPool(): Pool {
    if (this.pool) return this.pool;
    const db = this.config.db;
    if (db?.pool) return (this.pool = db.pool);
    if (!db?.connectionString)
      throw new Error('SupabaseConfig.db.connectionString is required');
    const ssl = db.ssl ?? true;
    this.pool = new Pool({
      ...db.options,
      connectionString: db.connectionString,
      // TLS settings come only from the configuration, never from URL parameters.
      ssl:
        ssl === false
          ? false
          : ssl === true
            ? { rejectUnauthorized: true }
            : ssl,
      max: db.max ?? 5,
      statement_timeout: db.statementTimeout ?? 15000,
    });
    // An idle client that loses its connection must not crash the process;
    // the next query gets a fresh client.
    this.pool.on('error', () => undefined);
    return this.pool;
  }
}
