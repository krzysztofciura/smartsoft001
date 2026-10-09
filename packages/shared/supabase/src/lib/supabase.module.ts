import { DynamicModule } from '@nestjs/common';

import {
  IAttachmentRepository,
  IItemRepository,
  IUnitOfWork,
} from '@smartsoft001/domain-core';

import { SupabaseAuthService } from './auth/supabase-auth.service';
import { SupabaseAttachmentRepository } from './repositories/attachment.repository';
import { SupabaseItemRepository } from './repositories/item.repository';
import { SupabaseConfig } from './supabase.config';
import { SupabasePool } from './supabase.pool';
import { SupabaseUnitOfWork } from './supabase.unitofwork';

/**
 * Binds the `domain-core` storage contracts to Supabase, like `MongoModule`
 * does for MongoDB: `IItemRepository` (a PostgreSQL table), `IUnitOfWork`
 * (a PostgreSQL transaction), `IAttachmentRepository` (Storage), plus
 * `SupabaseAuthService` for Supabase Auth. Each call has its own connection pool.
 *
 * @example
 * SupabaseModule.forRoot({
 *   db: { connectionString: process.env.DATABASE_URL },
 *   url: process.env.SUPABASE_URL,
 *   serviceKey: process.env.SUPABASE_SERVICE_KEY,
 *   table: 'products',
 *   bucket: 'products',
 * })
 */
export class SupabaseModule {
  static forRoot(config: SupabaseConfig): DynamicModule {
    const providers = [
      { provide: SupabaseConfig, useValue: config },
      SupabasePool,
      SupabaseAuthService,
      { provide: IItemRepository, useClass: SupabaseItemRepository },
      {
        provide: IAttachmentRepository,
        useClass: SupabaseAttachmentRepository,
      },
      { provide: IUnitOfWork, useClass: SupabaseUnitOfWork },
    ];

    return {
      module: SupabaseModule,
      providers,
      exports: providers,
    };
  }
}
