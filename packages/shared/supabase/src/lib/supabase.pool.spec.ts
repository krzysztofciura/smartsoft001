import type { Pool } from 'pg';

import { SupabaseAttachmentRepository } from './repositories/attachment.repository';
import { SupabaseConfig } from './supabase.config';
import { SupabasePool } from './supabase.pool';

describe('shared-supabase: SupabasePool with an application pool', () => {
  it('should run transactions on the given pool and leave it open', async () => {
    // Arrange
    const client = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    };
    const shared = {
      connect: jest.fn().mockResolvedValue(client),
      end: jest.fn(),
    } as unknown as Pool;
    const pool = new SupabasePool({
      table: 'items',
      db: { pool: shared },
    } as SupabaseConfig);

    // Act
    const result = await pool.transaction(async (c) => {
      await c.query('SELECT 1');
      return 'done';
    });
    await pool.onModuleDestroy();

    // Assert
    expect(result).toBe('done');
    expect(shared.connect).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls.map((call) => call[0])).toEqual([
      'BEGIN',
      'SELECT 1',
      'COMMIT',
    ]);
    expect(shared.end).not.toHaveBeenCalled();
  });

  it('should still require a connection string without a pool', async () => {
    // Arrange
    const pool = new SupabasePool({ table: 'items', db: {} } as SupabaseConfig);

    // Act & Assert
    await expect(pool.connect()).rejects.toThrow(
      'SupabaseConfig.db.connectionString is required',
    );
  });
});

describe('shared-supabase: SupabaseAttachmentRepository folder', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('should keep objects in the configured folder of the bucket', async () => {
    // Arrange
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const repository = new SupabaseAttachmentRepository({
      table: 'files',
      storageUrl: 'http://storage.internal',
      serviceKey: 'scoped-token',
      bucket: 'media',
      folder: 'medical',
    } as SupabaseConfig);

    // Act
    await repository.upload({
      id: 'a1.jpg',
      fileName: 'a1.jpg',
      stream: Buffer.from('x'),
      mimeType: 'image/jpeg',
      encoding: '7bit',
    });

    // Assert
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://storage.internal/object/media/medical/a1.jpg',
    );
  });

  it('should refuse a folder that could leave the bucket', async () => {
    // Arrange
    const repository = new SupabaseAttachmentRepository({
      table: 'files',
      storageUrl: 'http://storage.internal',
      serviceKey: 'scoped-token',
      bucket: 'media',
      folder: '../other',
    } as SupabaseConfig);

    // Act & Assert
    await expect(repository.delete('a1')).rejects.toThrow(
      'Invalid SupabaseConfig.folder',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
