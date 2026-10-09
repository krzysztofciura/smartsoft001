import 'reflect-metadata';

import { DomainValidationError } from '@smartsoft001/domain-core';
import { Field, Model } from '@smartsoft001/models';

import { SupabaseConfig, ISupabaseDocumentCipher } from '../supabase.config';
import { SupabaseItemRepository } from './item.repository';

interface Call {
  sql: string;
  params: unknown[];
}

function fakePool(rows: Record<string, unknown>[] = [], rowCount = 1) {
  const calls: Call[] = [];
  const client = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT count(*)'))
        return { rows: [{ count: String(rows.length) }], rowCount: 1 };
      if (sql.startsWith('SELECT')) return { rows, rowCount: rows.length };
      return { rows: [], rowCount };
    }),
  };
  const pool = {
    table: '"public"."items"',
    transaction: jest.fn(async (work: (c: unknown) => Promise<unknown>) =>
      work(client),
    ),
  };
  return { pool, client, calls };
}

function repository(config: Partial<SupabaseConfig>, pool: unknown) {
  return new SupabaseItemRepository<any>(
    pool as never,
    { table: 'items', ...config } as SupabaseConfig,
  );
}

const user = { username: 'anna', permissions: [] };

describe('shared-supabase: SupabaseItemRepository', () => {
  it('should insert the document without its id, with the acting user and the declared columns', async () => {
    // Arrange
    const { pool, calls } = fakePool();
    const repo = repository({ columns: { ownerId: 'owner_id' } }, pool);

    // Act
    await repo.create({ id: 'a1', name: 'Test', ownerId: 'u1' }, user);

    // Assert
    expect(calls[0].sql).toBe(
      'INSERT INTO "public"."items" ("id", "data", "info", "owner_id") VALUES ($1, $2, $3::jsonb, $4)',
    );
    expect(calls[0].params[0]).toBe('a1');
    expect(JSON.parse(calls[0].params[1] as string)).toEqual({
      name: 'Test',
      ownerId: 'u1',
    });
    expect(JSON.parse(calls[0].params[2] as string)).toEqual({
      create: { username: 'anna', date: expect.any(String) },
    });
    expect(calls[0].params[3]).toBe('u1');
  });

  it('should seal the document with the cipher, bound to its row', async () => {
    // Arrange
    const { pool, calls } = fakePool();
    const cipher: ISupabaseDocumentCipher = {
      seal: jest.fn(
        async (text, context) =>
          `sealed:${context.table}:${context.id}:${text}`,
      ),
      open: jest.fn(),
    };
    const repo = repository({ cipher }, pool);

    // Act
    await repo.create({ id: 'a1', secret: 'x' }, user);

    // Assert
    expect(calls[0].sql).toContain('("id", "envelope", "info")');
    expect(calls[0].params[1]).toBe('sealed:items:a1:{"secret":"x"}');
    expect(cipher.seal).toHaveBeenCalledWith('{"secret":"x"}', {
      schema: 'public',
      table: 'items',
      id: 'a1',
    });
  });

  it('should run on the transaction client of a unit of work instead of its own transaction', async () => {
    // Arrange
    const { pool } = fakePool();
    const scoped = { query: jest.fn(async () => ({ rows: [], rowCount: 1 })) };
    const repo = repository({}, pool);

    // Act
    await repo.delete('a1', user, { transaction: { connection: scoped } });

    // Assert
    expect(pool.transaction).not.toHaveBeenCalled();
    expect(scoped.query).toHaveBeenCalledWith(
      'DELETE FROM "public"."items" WHERE "id" = $1',
      ['a1'],
    );
  });

  it('should merge a partial update into the document like $set', async () => {
    // Arrange
    const { pool, calls } = fakePool();
    const repo = repository({ columns: { status: 'status' } }, pool);

    // Act
    await repo.updatePartial({ id: 'a1', status: 'paid', note: 'ok' }, user);

    // Assert
    expect(calls[0].sql).toBe(
      `UPDATE "public"."items" SET "data" = "data" || $2::jsonb, "info" = "info" || jsonb_build_object('update', $3::jsonb), "status" = $4 WHERE "id" = $1`,
    );
    expect(JSON.parse(calls[0].params[1] as string)).toEqual({
      status: 'paid',
      note: 'ok',
    });
    expect(calls[0].params[3]).toBe('paid');
  });

  it('should read, open, merge and seal encrypted documents under FOR UPDATE', async () => {
    // Arrange
    const { pool, calls } = fakePool([{ id: 'a1', envelope: 'E' }]);
    const cipher: ISupabaseDocumentCipher = {
      seal: async (text) => 'S' + text,
      open: async () => '{"name":"A","n":1}',
    };
    const repo = repository({ cipher }, pool);

    // Act
    await repo.updatePartial({ id: 'a1', n: 2 }, user);

    // Assert
    expect(calls[0].sql).toBe(
      'SELECT "id", "envelope" FROM "public"."items" WHERE "id" = $1 FOR UPDATE',
    );
    expect(calls[1].params[1]).toBe('S{"name":"A","n":2}');
  });

  it('should report whether compareAndSet matched, comparing expected values with $eq', async () => {
    // Arrange
    const matched = fakePool([], 1);
    const missed = fakePool([], 0);

    // Act
    const first = await repository({}, matched.pool).compareAndSet(
      'a1',
      { status: 'new' },
      { status: 'paid' },
      user,
    );
    const second = await repository({}, missed.pool).compareAndSet(
      'a1',
      { status: { $ne: 'x' } } as never,
      { status: 'paid' },
      user,
    );

    // Assert
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(matched.calls[0].sql).toContain(
      'WHERE "id" = $1 AND COALESCE(("data" #> \'{status}\') = $2::jsonb',
    );
    expect(missed.calls[0].params[1]).toBe(JSON.stringify({ $ne: 'x' }));
  });

  it('should return an item with its id and without bookkeeping', async () => {
    // Arrange
    const { pool } = fakePool([
      {
        id: 'a1',
        data: { name: 'Test' },
        info: { create: {} },
        owner_id: 'u1',
      },
    ]);
    const repo = repository({}, pool);

    // Act
    const item = await repo.getById('a1');

    // Assert
    expect(item).toEqual({ name: 'Test', id: 'a1' });
  });

  it('should page, sort, count and project a criteria query', async () => {
    // Arrange
    const { pool, calls } = fakePool([
      { id: 'a1', data: { name: 'Test', secret: 's' } },
    ]);
    const repo = repository({}, pool);

    // Act
    const result = await repo.getByCriteria(
      { name: 'Test' },
      { sort: { name: -1 }, limit: 10, skip: 20, project: { name: 1 } },
    );

    // Assert
    expect(result).toEqual({
      data: [{ id: 'a1', name: 'Test' }],
      totalCount: 1,
    });
    expect(calls[0].sql).toMatch(
      /^SELECT count\(\*\)::text AS count FROM "public"."items" WHERE /,
    );
    expect(calls[1].sql).toMatch(
      /ORDER BY \("data" #> '\{name\}'\) DESC NULLS LAST LIMIT \$2 OFFSET \$3$/,
    );
    expect(calls[1].params).toEqual(['"Test"', 10, 20]);
  });

  it('should refuse aggregation options the table cannot answer', async () => {
    // Arrange
    const { pool } = fakePool();

    // Act & Assert
    await expect(
      repository({}, pool).getByCriteria({}, { group: { _id: '$x' } }),
    ).rejects.toThrow(DomainValidationError);
  });

  it('should answer $search with the model search fields, escaped', async () => {
    // Arrange
    @Model({})
    class Product {
      @Field({ search: true }) name!: string;
      @Field({ search: true }) code!: string;
      @Field({}) price!: number;
    }
    const { pool, calls } = fakePool([]);
    const repo = repository({ type: Product }, pool);

    // Act
    await repo.countByCriteria({ $search: 'a.b', price: 5 });

    // Assert
    expect(calls[0].sql).toContain(
      `AND (((("data" #>> '{name}') ~* $2) OR (("data" #>> '{code}') ~* $3)))`,
    );
    expect(calls[0].params).toEqual(['5', 'a\\.b', 'a\\.b']);
  });

  it('should not mutate the criteria object of the caller', async () => {
    // Arrange
    const { pool } = fakePool();
    const criteria = { $search: 'x', name: 'y' };

    // Act
    await repository({}, pool).countByCriteria(criteria);

    // Assert
    expect(criteria).toEqual({ $search: 'x', name: 'y' });
  });

  it('should refuse an item without an id', async () => {
    // Arrange
    const { pool } = fakePool();

    // Act & Assert
    await expect(
      repository({}, pool).create({ name: 'x' }, user),
    ).rejects.toThrow(DomainValidationError);
  });
});
