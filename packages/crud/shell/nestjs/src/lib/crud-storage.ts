import { DynamicModule } from '@nestjs/common';

/** MongoDB settings of the default storage (`MongoModule.forRoot`). */
export interface ICrudMongoDb {
  host: string;
  port: number;
  database: string;
  username?: string;
  password?: string;
  collection?: string;
  type?: any;
}

/**
 * Where a CRUD module keeps its data. Either `db` (MongoDB through
 * `@smartsoft001/mongo`, as before) or `persistence`: any dynamic module that
 * provides and exports `IItemRepository`, `IAttachmentRepository` and
 * `IUnitOfWork` from `@smartsoft001/domain-core`, e.g.
 * `SupabaseModule.forRoot({ ... })` from `@smartsoft001/supabase`.
 * `persistence` wins when both are given.
 */
export interface ICrudStorageOptions {
  db?: ICrudMongoDb;
  persistence?: DynamicModule;
}

/**
 * The storage module of a CRUD module. MongoDB is loaded only when it is
 * used, so an application on another storage does not need the MongoDB
 * driver installed.
 */
export function crudStorage(options: ICrudStorageOptions): DynamicModule {
  if (options.persistence) return options.persistence;
  if (!options.db)
    throw new Error(
      'A CRUD module needs db (MongoDB) or persistence (a storage module)',
    );
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { MongoModule } =
    require('@smartsoft001/mongo') as typeof import('@smartsoft001/mongo');
  return MongoModule.forRoot(options.db);
}
