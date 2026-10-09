import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { Observable, Observer } from 'rxjs';
import { share } from 'rxjs/operators';

import {
  DomainValidationError,
  IEntity,
  IItemRepository,
  IItemRepositoryOptions,
  ISpecification,
} from '@smartsoft001/domain-core';
import { getModelFieldsWithOptions } from '@smartsoft001/models';
import { IUser } from '@smartsoft001/users';
import { ObjectService } from '@smartsoft001/utils';

import { SupabaseConfig } from '../supabase.config';
import { SupabasePool } from '../supabase.pool';
import { ISupabaseTransaction } from '../supabase.unitofwork';
import { CriteriaTranslator, quoteIdentifier } from './criteria';
import { ItemChangedData } from './interfaces';

type Row = Record<string, unknown>;
const SUPPORTED_OPTIONS = [
  'sort',
  'skip',
  'offset',
  'limit',
  'project',
  'fields',
  'omit',
  'session',
  'allowDiskUse',
];

/**
 * `IItemRepository` on a PostgreSQL table of the Supabase project: one row per
 * item with the document in `data` (jsonb), or sealed in `envelope` when a
 * `cipher` is configured, the acting user and time in `info`, and the declared
 * `columns` kept next to it. Criteria use the MongoDB syntax of the other
 * Smartsoft repositories (see `CriteriaTranslator`). The table is created with
 * `supabaseItemTableSql`.
 */
@Injectable()
export class SupabaseItemRepository<
  T extends IEntity<string>,
> extends IItemRepository<T> {
  protected readonly translator: CriteriaTranslator;

  constructor(
    protected readonly pool: SupabasePool,
    protected readonly config: SupabaseConfig,
  ) {
    super();
    this.translator = new CriteriaTranslator({
      columns: config.columns ?? {},
      encrypted: !!config.cipher,
    });
  }

  async create(
    item: T,
    user: IUser | null,
    repoOptions?: IItemRepositoryOptions,
  ): Promise<void> {
    await this.write('create', item, user, repoOptions, (client) =>
      this.insert(client, item, user),
    );
  }

  async createMany(
    list: T[],
    user: IUser,
    repoOptions?: IItemRepositoryOptions,
  ): Promise<void> {
    await this.write('createMany', null, user, repoOptions, async (client) => {
      for (const item of list) await this.insert(client, item, user);
    });
  }

  async update(
    item: T,
    user: IUser | null,
    repoOptions?: IItemRepositoryOptions,
  ): Promise<void> {
    await this.write('update', item, user, repoOptions, async (client) => {
      const { id, document } = this.split(item);
      const stored = await this.storedDocument(id, document);
      const values = [
        id,
        stored,
        JSON.stringify(this.stamp(user)),
        ...this.columnValues(document),
      ];
      await client.query(
        `UPDATE ${this.pool.table} SET ${this.documentColumn} = $2, "info" = "info" || jsonb_build_object('update', $3::jsonb)${this.columnAssignments(4)} WHERE "id" = $1`,
        values,
      );
    });
  }

  async updatePartial(
    item: Partial<T> & { id: string },
    user: IUser | null,
    repoOptions?: IItemRepositoryOptions,
  ): Promise<void> {
    await this.write(
      'updatePartial',
      item,
      user,
      repoOptions,
      async (client) => {
        await this.patch(client, 'WHERE "id" = $1', [item.id], item, user);
      },
    );
  }

  async updatePartialManyByCriteria(
    criteria: any,
    set: Partial<T>,
    user: IUser,
    repoOptions?: IItemRepositoryOptions,
  ): Promise<void> {
    const where = this.translator.where(this.search(criteria));
    await this.write(
      'updatePartialManyByCriteria',
      { ...criteria, set },
      user,
      repoOptions,
      async (client) => {
        await this.patch(client, `WHERE ${where.sql}`, where.params, set, user);
      },
    );
  }

  updatePartialManyBySpecification(
    spec: ISpecification,
    set: Partial<T>,
    user: IUser,
    repoOptions?: IItemRepositoryOptions,
  ): Promise<void> {
    return this.updatePartialManyByCriteria(
      spec.criteria,
      set,
      user,
      repoOptions,
    );
  }

  /**
   * One atomic `UPDATE … WHERE id = $1 AND <expected>`: every expected value is
   * compared with `$eq` (never interpreted as an operator) and the result says
   * whether the row matched. With a `cipher` the expected fields must be
   * declared columns.
   */
  async compareAndSet(
    id: string,
    expected: Partial<T>,
    set: Partial<T>,
    user: IUser | null,
    repoOptions?: IItemRepositoryOptions,
  ): Promise<boolean> {
    const condition: Record<string, unknown> = { id };
    for (const [key, value] of Object.entries(expected)) {
      if (key !== 'id') condition[key] = { $eq: value ?? null };
    }
    const where = this.translator.where(condition);
    let matched = false;
    await this.write(
      'compareAndSet',
      { id, expected, set },
      user,
      repoOptions,
      async (client) => {
        matched =
          (await this.patch(
            client,
            `WHERE ${where.sql}`,
            where.params,
            set,
            user,
          )) === 1;
      },
    );
    return matched;
  }

  async delete(
    id: string,
    user: IUser,
    repoOptions?: IItemRepositoryOptions,
  ): Promise<void> {
    await this.write('delete', { id }, user, repoOptions, async (client) => {
      await client.query(`DELETE FROM ${this.pool.table} WHERE "id" = $1`, [
        id,
      ]);
    });
  }

  async getById(
    id: string,
    repoOptions?: IItemRepositoryOptions,
  ): Promise<T | null> {
    return this.run(repoOptions, async (client) => {
      const result = await client.query(
        `SELECT * FROM ${this.pool.table} WHERE "id" = $1`,
        [id],
      );
      return result.rows[0] ? this.toItem(result.rows[0]) : null;
    });
  }

  async getByCriteria(
    criteria: any,
    options: any = {},
  ): Promise<{ data: T[]; totalCount: number }> {
    const unsupported = Object.keys(options ?? {}).filter(
      (key) => !SUPPORTED_OPTIONS.includes(key),
    );
    if (unsupported.length)
      throw new DomainValidationError(
        `Unsupported query options: ${unsupported.join(', ')}`,
      );
    const where = this.translator.where(this.search(criteria));
    const order = this.translator.orderBy(options?.sort);
    const limit = this.bound(options?.limit, 'limit');
    const skip = this.bound(options?.skip ?? options?.offset, 'skip');
    return this.run(this.transactionOf(options), async (client) => {
      const count = await client.query(
        `SELECT count(*)::text AS count FROM ${this.pool.table} WHERE ${where.sql}`,
        where.params,
      );
      const params = [...where.params];
      let sql = `SELECT * FROM ${this.pool.table} WHERE ${where.sql}`;
      if (order) sql += ` ORDER BY ${order}`;
      if (limit !== undefined) {
        params.push(limit);
        sql += ` LIMIT $${params.length}`;
      }
      if (skip) {
        params.push(skip);
        sql += ` OFFSET $${params.length}`;
      }
      const rows = (await client.query(sql, params)).rows;
      const data: T[] = [];
      for (const row of rows)
        data.push(this.project(await this.toItem(row), options));
      return { data, totalCount: Number(count.rows[0]?.['count'] ?? 0) };
    });
  }

  getBySpecification(
    spec: ISpecification,
    options: any = {},
  ): Promise<{ data: T[]; totalCount: number }> {
    return this.getByCriteria(spec.criteria, options);
  }

  async countByCriteria(criteria: any): Promise<number> {
    const where = this.translator.where(this.search(criteria));
    return this.run(undefined, async (client) => {
      const result = await client.query(
        `SELECT count(*)::text AS count FROM ${this.pool.table} WHERE ${where.sql}`,
        where.params,
      );
      return Number(result.rows[0]?.['count'] ?? 0);
    });
  }

  countBySpecification(spec: ISpecification): Promise<number> {
    return this.countByCriteria(spec.criteria);
  }

  async clear(user: IUser | IItemRepositoryOptions): Promise<void> {
    const options =
      user && 'transaction' in user
        ? (user as IItemRepositoryOptions)
        : undefined;
    const actor = options ? null : (user as IUser);
    await this.write('clear', null, actor, options, async (client) => {
      await client.query(`DELETE FROM ${this.pool.table}`);
    });
  }

  /**
   * Changes announced by the table trigger of `supabaseItemTableSql({ changes: true })`
   * through `LISTEN/NOTIFY`. Created and updated items are read back (with the
   * configured context and decryption); an update carries the whole item in
   * `updatedFields`. Each subscription holds one pooled connection until it ends.
   */
  changesByCriteria(criteria: { id?: string }): Observable<ItemChangedData> {
    const channel = this.channel;
    return new Observable((observer: Observer<ItemChangedData>) => {
      let client: PoolClient | undefined;
      let closed = false;
      const listener = (message: { channel: string; payload?: string }) => {
        if (message.channel !== channel || !message.payload) return;
        let change: { id?: unknown; type?: unknown };
        try {
          change = JSON.parse(message.payload);
        } catch {
          return;
        }
        if (
          typeof change.id !== 'string' ||
          (criteria?.id && change.id !== criteria.id)
        )
          return;
        const id = change.id;
        if (change.type === 'delete') {
          observer.next({ id, type: 'delete' });
          return;
        }
        this.getById(id).then(
          (item) => {
            if (!item || closed) return;
            observer.next(
              change.type === 'insert'
                ? { id, type: 'create', data: item }
                : {
                    id,
                    type: 'update',
                    data: { updatedFields: item, removedFields: [] },
                  },
            );
          },
          (error) => observer.error(error),
        );
      };
      this.pool
        .connect()
        .then(async (connection) => {
          if (closed) {
            connection.release();
            return;
          }
          client = connection;
          connection.on('notification', listener);
          await connection.query(`LISTEN ${quoteIdentifier(channel)}`);
        })
        .catch((error) => observer.error(error));
      return () => {
        closed = true;
        const connection = client;
        if (!connection) return;
        connection.removeListener('notification', listener);
        connection
          .query(`UNLISTEN ${quoteIdentifier(channel)}`)
          .catch(() => undefined)
          .finally(() => connection.release());
      };
    }).pipe(share());
  }

  /** Notification channel of this table (the trigger of `supabaseItemTableSql` uses the same name). */
  get channel(): string {
    return supabaseChangeChannel(
      this.config.schema ?? 'public',
      this.config.table,
    );
  }

  protected get documentColumn(): string {
    return this.config.cipher ? '"envelope"' : '"data"';
  }

  /** Runs on the scope's client, or in a transaction of its own with the context hook. */
  protected run<R>(
    repoOptions: IItemRepositoryOptions | undefined,
    work: (client: PoolClient) => Promise<R>,
  ): Promise<R> {
    const connection = (
      repoOptions?.transaction as ISupabaseTransaction | undefined
    )?.connection;
    return connection ? work(connection) : this.pool.transaction(work);
  }

  protected async write(
    type: string,
    item: unknown,
    user: IUser | null,
    repoOptions: IItemRepositoryOptions | undefined,
    work: (client: PoolClient) => Promise<void>,
  ): Promise<void> {
    try {
      await this.run(repoOptions, work);
      this.logChange(type, item, user, null).then();
    } catch (error) {
      this.logChange(type, item, user, error).then();
      throw error;
    }
  }

  protected async insert(
    client: PoolClient,
    item: T,
    user: IUser | null,
  ): Promise<void> {
    const { id, document } = this.split(item);
    const columns = Object.values(this.config.columns ?? {})
      .map((name) => `, ${quoteIdentifier(name)}`)
      .join('');
    const values = [
      id,
      await this.storedDocument(id, document),
      JSON.stringify({ create: this.stamp(user) }),
      ...this.columnValues(document),
    ];
    const placeholders = values.map((_, index) => `$${index + 1}`);
    placeholders[2] += '::jsonb';
    await client.query(
      `INSERT INTO ${this.pool.table} ("id", ${this.documentColumn}, "info"${columns}) VALUES (${placeholders.join(', ')})`,
      values,
    );
  }

  /**
   * Merges `set` into the matching documents (top-level keys replace, like
   * MongoDB `$set`) and returns the number of rows changed. Encrypted
   * documents are read under `FOR UPDATE`, opened, merged and sealed again.
   */
  protected async patch(
    client: PoolClient,
    where: string,
    params: unknown[],
    set: Partial<T> | Record<string, unknown>,
    user: IUser | null,
  ): Promise<number> {
    const fields = ObjectService.removeTypes(set) ?? {};
    delete fields.id;
    const columns = this.columnValues(fields, true);
    if (!this.config.cipher) {
      const values = [
        ...params,
        JSON.stringify(fields),
        JSON.stringify(this.stamp(user)),
        ...columns.values,
      ];
      const document = params.length + 1;
      const result = await client.query(
        `UPDATE ${this.pool.table} SET "data" = "data" || $${document}::jsonb, "info" = "info" || jsonb_build_object('update', $${document + 1}::jsonb)${this.assignments(columns.names, document + 2)} ${where}`,
        values,
      );
      return result.rowCount ?? 0;
    }
    const rows = (
      await client.query(
        `SELECT "id", "envelope" FROM ${this.pool.table} ${where} FOR UPDATE`,
        params,
      )
    ).rows;
    for (const row of rows) {
      const id = String(row['id']);
      const merged = { ...(await this.openDocument(id, row)), ...fields };
      await client.query(
        `UPDATE ${this.pool.table} SET "envelope" = $2, "info" = "info" || jsonb_build_object('update', $3::jsonb)${this.assignments(columns.names, 4)} WHERE "id" = $1`,
        [
          id,
          await this.storedDocument(id, merged),
          JSON.stringify(this.stamp(user)),
          ...columns.values,
        ],
      );
    }
    return rows.length;
  }

  protected split(item: Partial<T> & { id?: string }): {
    id: string;
    document: Row;
  } {
    const document = ObjectService.removeTypes(item) as Row;
    const id = document['id'];
    if (typeof id !== 'string' || !id)
      throw new DomainValidationError('Item id is required');
    delete document['id'];
    return { id, document };
  }

  protected async storedDocument(id: string, document: Row): Promise<string> {
    const text = JSON.stringify(document);
    return this.config.cipher
      ? this.config.cipher.seal(text, this.cipherContext(id))
      : text;
  }

  protected async openDocument(id: string, row: Row): Promise<Row> {
    if (!this.config.cipher) return (row['data'] as Row) ?? {};
    return JSON.parse(
      await this.config.cipher.open(
        String(row['envelope']),
        this.cipherContext(id),
      ),
    );
  }

  protected async toItem(row: Row): Promise<T> {
    const id = String(row['id']);
    return { ...(await this.openDocument(id, row)), id } as unknown as T;
  }

  protected stamp(user: IUser | null): {
    username: string | null;
    date: string;
  } {
    return { username: user?.username ?? null, date: new Date().toISOString() };
  }

  protected columnValues(document: Row): unknown[];
  protected columnValues(
    document: Row,
    onlyPresent: true,
  ): { names: string[]; values: unknown[] };
  protected columnValues(
    document: Row,
    onlyPresent?: true,
  ): unknown[] | { names: string[]; values: unknown[] } {
    const entries = Object.entries(this.config.columns ?? {});
    if (!onlyPresent) return entries.map(([field]) => document[field] ?? null);
    const present = entries.filter(([field]) => field in document);
    return {
      names: present.map(([, column]) => column),
      values: present.map(([field]) => document[field] ?? null),
    };
  }

  protected columnAssignments(start: number): string {
    return this.assignments(Object.values(this.config.columns ?? {}), start);
  }

  protected assignments(names: string[], start: number): string {
    return names
      .map((name, index) => `, ${quoteIdentifier(name)} = $${start + index}`)
      .join('');
  }

  /** `$search` answered by the model's `search` fields, as in `MongoItemRepository`. */
  protected search(criteria: any): any {
    if (!criteria || typeof criteria !== 'object' || !('$search' in criteria))
      return criteria ?? {};
    const { $search, ...rest } = criteria;
    if (typeof $search !== 'string' || !$search) return rest;
    const fields = this.config.type
      ? getModelFieldsWithOptions(new this.config.type()).filter(
          (field) => field.options.search,
        )
      : [];
    if (!fields.length) return rest;
    const escaped = $search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const any = {
      $or: fields.map((field) => ({
        [field.key]: { $regex: escaped, $options: 'i' },
      })),
    };
    return Object.keys(rest).length ? { $and: [rest, any] } : any;
  }

  protected project(item: T, options: any): T {
    const include = options?.project ?? options?.fields;
    const omit = options?.omit;
    let result: Row = item as unknown as Row;
    if (include && typeof include === 'object') {
      const keys = Object.entries(include).filter(([, on]) => on);
      if (keys.length)
        result = Object.fromEntries([
          ['id', item.id],
          ...keys
            .filter(([key]) => key in result)
            .map(([key]) => [key, result[key]]),
        ]);
      else for (const key of Object.keys(include)) delete result[key];
    }
    if (omit && typeof omit === 'object')
      for (const key of Object.keys(omit)) delete result[key];
    return result as unknown as T;
  }

  protected bound(value: unknown, name: string): number | undefined {
    if (value === undefined || value === null) return undefined;
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0)
      throw new DomainValidationError(`Invalid ${name}`);
    return number;
  }

  protected transactionOf(options: any): IItemRepositoryOptions | undefined {
    return options?.transaction
      ? { transaction: options.transaction }
      : undefined;
  }

  protected cipherContext(id: string) {
    return {
      schema: this.config.schema ?? 'public',
      table: this.config.table,
      id,
    };
  }

  /** Opt-in audit row in `config.changeLog`; failures only warn and never fail the write. */
  protected async logChange(
    type: string,
    item: unknown,
    user: IUser | null,
    error: unknown,
  ): Promise<void> {
    if (!this.config.changeLog) return;
    try {
      const table = `${quoteIdentifier(this.config.schema ?? 'public')}.${quoteIdentifier(this.config.changeLog)}`;
      await this.pool.transaction((client) =>
        client.query(
          `INSERT INTO ${table} ("type", "table_name", "item", "username", "error", "date") VALUES ($1, $2, $3::jsonb, $4, $5, now())`,
          [
            type,
            this.config.table,
            JSON.stringify(item ?? null),
            user?.username ?? null,
            error ? String((error as Error).message ?? error) : null,
          ],
        ),
      );
    } catch (logError) {
      console.warn('Supabase change log failed', (logError as Error)?.message);
    }
  }
}

/** Channel of the change trigger: `ss_<schema>_<table>`, at most 63 characters. */
export function supabaseChangeChannel(schema: string, table: string): string {
  quoteIdentifier(schema);
  quoteIdentifier(table);
  return `ss_${schema}_${table}`.slice(0, 63);
}
