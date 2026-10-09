import 'reflect-metadata';

import { Test } from '@nestjs/testing';

import {
  IAttachmentRepository,
  IItemRepository,
  IUnitOfWork,
} from '@smartsoft001/domain-core';

import { SupabaseAuthService } from './auth/supabase-auth.service';
import { SupabaseAttachmentRepository } from './repositories/attachment.repository';
import { SupabaseItemRepository } from './repositories/item.repository';
import { SupabaseModule } from './supabase.module';
import { SupabasePool } from './supabase.pool';
import {
  supabaseChangeLogTableSql,
  supabaseItemTableSql,
} from './supabase.sql';
import { SupabaseUnitOfWork } from './supabase.unitofwork';

describe('shared-supabase: SupabaseModule', () => {
  it('should bind the domain-core contracts to the Supabase implementations', async () => {
    // Arrange
    const moduleRef = await Test.createTestingModule({
      imports: [
        SupabaseModule.forRoot({
          table: 'products',
          db: { connectionString: 'postgres://u:p@localhost:5432/db' },
        }),
      ],
    }).compile();

    // Act
    const items = moduleRef.get(IItemRepository);
    const attachments = moduleRef.get(IAttachmentRepository);
    const unitOfWork = moduleRef.get(IUnitOfWork);

    // Assert
    expect(items).toBeInstanceOf(SupabaseItemRepository);
    expect(attachments).toBeInstanceOf(SupabaseAttachmentRepository);
    expect(unitOfWork).toBeInstanceOf(SupabaseUnitOfWork);
    expect(moduleRef.get(SupabaseAuthService)).toBeInstanceOf(
      SupabaseAuthService,
    );
    expect(moduleRef.get(SupabasePool).table).toBe('"public"."products"');
    await moduleRef.close();
  });
});

describe('shared-supabase: supabaseItemTableSql', () => {
  it('should create a forced row-level-security table with columns and the change trigger', () => {
    // Act
    const sql = supabaseItemTableSql({
      schema: 'shop',
      table: 'orders',
      columns: { owner_id: 'uuid' },
      encrypted: true,
      changes: true,
    });

    // Assert
    expect(sql).toContain('CREATE TABLE "shop"."orders" (');
    expect(sql).toContain('"envelope" text NOT NULL');
    expect(sql).toContain('"owner_id" uuid');
    expect(sql).toContain(
      'ALTER TABLE "shop"."orders" FORCE ROW LEVEL SECURITY;',
    );
    expect(sql).toContain("pg_notify('ss_shop_orders'");
  });

  it('should refuse unknown column types and unsafe names', () => {
    // Act & Assert
    expect(() =>
      supabaseItemTableSql({
        table: 'orders',
        columns: { x: 'text; DROP' as never },
      }),
    ).toThrow();
    expect(() => supabaseItemTableSql({ table: 'Orders' })).toThrow();
    expect(supabaseChangeLogTableSql({ table: 'changes' })).toContain(
      '"public"."changes"',
    );
  });
});
