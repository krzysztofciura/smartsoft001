import { SupabaseConfig } from './supabase.config';
import { SupabasePool } from './supabase.pool';
import { SupabaseUnitOfWork } from './supabase.unitofwork';

function poolWith(
  client: { query: jest.Mock; release: jest.Mock },
  config: Partial<SupabaseConfig> = {},
) {
  const pool = new SupabasePool({
    table: 'items',
    ...config,
  } as SupabaseConfig);
  jest.spyOn(pool, 'connect').mockResolvedValue(client as never);
  return pool;
}

describe('shared-supabase: SupabaseUnitOfWork', () => {
  it('should run the scope between BEGIN and COMMIT on one client, after the context hook', async () => {
    // Arrange
    const client = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    };
    const context = jest.fn(async (c: { query: jest.Mock }) => {
      await c.query("SELECT set_config('app.tenant', 't1', true)");
    });
    const unitOfWork = new SupabaseUnitOfWork(
      poolWith(client, { context: context as never }),
    );
    let received: unknown;

    // Act
    await unitOfWork.scope(async (transaction) => {
      received = transaction.connection;
      await transaction.connection.query('SELECT 1');
    });

    // Assert
    expect(received).toBe(client);
    expect(client.query.mock.calls.map((call) => call[0])).toEqual([
      'BEGIN',
      "SELECT set_config('app.tenant', 't1', true)",
      'SELECT 1',
      'COMMIT',
    ]);
    expect(client.release).toHaveBeenCalledWith(false);
  });

  it('should roll back and rethrow when the scope fails', async () => {
    // Arrange
    const client = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    };
    const unitOfWork = new SupabaseUnitOfWork(poolWith(client));

    // Act
    const run = unitOfWork.scope(async () => {
      throw new Error('boom');
    });

    // Assert
    await expect(run).rejects.toThrow('boom');
    expect(client.query.mock.calls.map((call) => call[0])).toEqual([
      'BEGIN',
      'ROLLBACK',
    ]);
    expect(client.release).toHaveBeenCalledWith(false);
  });

  it('should discard a client whose rollback fails', async () => {
    // Arrange
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql === 'ROLLBACK') throw new Error('connection lost');
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const unitOfWork = new SupabaseUnitOfWork(poolWith(client as never));

    // Act
    const run = unitOfWork.scope(async () => {
      throw new Error('boom');
    });

    // Assert
    await expect(run).rejects.toThrow('boom');
    expect(client.release).toHaveBeenCalledWith(true);
  });
});

describe('shared-supabase: SupabasePool', () => {
  it('should refuse to connect without a connection string and validate the table name', async () => {
    // Arrange
    const pool = new SupabasePool({ table: 'items' } as SupabaseConfig);
    const invalid = new SupabasePool({
      table: 'Items; DROP',
    } as SupabaseConfig);

    // Act & Assert
    await expect(pool.connect()).rejects.toThrow(
      'SupabaseConfig.db.connectionString is required',
    );
    expect(pool.table).toBe('"public"."items"');
    expect(() => invalid.table).toThrow();
  });
});

describe('shared-supabase: SupabasePool settings', () => {
  it('should pass pool options through while TLS and the URL come only from the config', async () => {
    // Arrange
    jest.resetModules();
    const created: Record<string, unknown>[] = [];
    jest.doMock('pg', () => ({
      Pool: jest
        .fn()
        .mockImplementation((settings: Record<string, unknown>) => {
          created.push(settings);
          return {
            on: jest.fn(),
            connect: jest.fn().mockResolvedValue({}),
            end: jest.fn(),
          };
        }),
    }));
    const { SupabasePool: Isolated } = await import('./supabase.pool');
    const pool = new Isolated({
      table: 'items',
      db: {
        connectionString: 'postgres://u:p@db:5432/app',
        options: {
          application_name: 'shop',
          ssl: false,
          connectionString: 'postgres://evil',
        } as never,
      },
    } as SupabaseConfig);

    // Act
    await pool.connect();

    // Assert
    expect(created[0]).toMatchObject({
      application_name: 'shop',
      connectionString: 'postgres://u:p@db:5432/app',
      ssl: { rejectUnauthorized: true },
      max: 5,
      statement_timeout: 15000,
    });
    jest.dontMock('pg');
  });
});
