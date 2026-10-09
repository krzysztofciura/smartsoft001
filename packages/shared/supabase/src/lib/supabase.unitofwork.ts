import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { ITransaction, IUnitOfWork } from '@smartsoft001/domain-core';

import { SupabasePool } from './supabase.pool';

/** The transaction handed to repositories: `connection` is the client inside `BEGIN … COMMIT`. */
export interface ISupabaseTransaction extends ITransaction {
  connection: PoolClient;
}

/**
 * `IUnitOfWork` on one PostgreSQL client: every repository call that receives
 * `{ transaction }` runs on that client, so the scope commits or rolls back
 * as a whole. The configured `context` hook runs once, right after `BEGIN`.
 *
 * @example
 * await this.unitOfWork.scope(async (transaction) => {
 *   await this.orders.updatePartial({ id, status: 'paid' }, user, { transaction });
 *   await this.payments.create(payment, user, { transaction });
 * });
 */
@Injectable()
export class SupabaseUnitOfWork extends IUnitOfWork {
  constructor(private readonly pool: SupabasePool) {
    super();
  }

  async scope(
    definition: (transaction: ITransaction) => Promise<void>,
  ): Promise<void> {
    await this.pool.transaction((connection) =>
      definition({ connection } as ISupabaseTransaction),
    );
  }
}
