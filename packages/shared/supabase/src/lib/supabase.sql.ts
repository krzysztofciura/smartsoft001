import { quoteIdentifier } from './repositories/criteria';
import { supabaseChangeChannel } from './repositories/item.repository';

/** Column types accepted by `supabaseItemTableSql`. */
export type SupabaseColumnType =
  | 'text'
  | 'uuid'
  | 'integer'
  | 'bigint'
  | 'numeric'
  | 'boolean'
  | 'timestamptz'
  | 'jsonb';
const TYPES: SupabaseColumnType[] = [
  'text',
  'uuid',
  'integer',
  'bigint',
  'numeric',
  'boolean',
  'timestamptz',
  'jsonb',
];

/**
 * DDL of an item table for `SupabaseItemRepository`, to put in a migration.
 * Row-level security is enabled and forced; policies stay with the application
 * (they depend on its roles and on what its `context` hook sets).
 *
 * @example
 * supabaseItemTableSql({ table: 'orders', columns: { owner_id: 'uuid' }, encrypted: true, changes: true })
 */
export function supabaseItemTableSql(options: {
  schema?: string;
  table: string;
  /** Column name to type, matching the values of `SupabaseConfig.columns`. */
  columns?: Record<string, SupabaseColumnType>;
  /** The repository has a `cipher`: the document goes to `envelope`. */
  encrypted?: boolean;
  /** Adds the trigger that feeds `changesByCriteria`. */
  changes?: boolean;
}): string {
  const schema = options.schema ?? 'public';
  const table = `${quoteIdentifier(schema)}.${quoteIdentifier(options.table)}`;
  const columns = Object.entries(options.columns ?? {}).map(([name, type]) => {
    if (!TYPES.includes(type))
      throw new Error(`Unsupported column type: ${type}`);
    return `  ${quoteIdentifier(name)} ${type}`;
  });
  const lines = [
    `CREATE TABLE ${table} (`,
    [
      '  "id" text PRIMARY KEY',
      options.encrypted
        ? '  "envelope" text NOT NULL'
        : `  "data" jsonb NOT NULL DEFAULT '{}'::jsonb`,
      `  "info" jsonb NOT NULL DEFAULT '{}'::jsonb`,
      ...columns,
    ].join(',\n'),
    ');',
    `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`,
  ];
  if (options.changes) {
    const channel = supabaseChangeChannel(schema, options.table);
    const fn = `${quoteIdentifier(schema)}.${quoteIdentifier(`${options.table}_notify`)}`;
    lines.push(
      `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$`,
      'BEGIN',
      `  PERFORM pg_notify('${channel}', json_build_object('id', COALESCE(NEW."id", OLD."id"), 'type', lower(TG_OP))::text);`,
      '  RETURN NULL;',
      'END $$;',
      `CREATE TRIGGER ${quoteIdentifier(`${options.table}_notify`)} AFTER INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn}();`,
    );
  }
  return lines.join('\n') + '\n';
}

/** DDL of the opt-in change log table (`SupabaseConfig.changeLog`). */
export function supabaseChangeLogTableSql(options: {
  schema?: string;
  table: string;
}): string {
  const table = `${quoteIdentifier(options.schema ?? 'public')}.${quoteIdentifier(options.table)}`;
  return (
    [
      `CREATE TABLE ${table} (`,
      '  "type" text NOT NULL,',
      '  "table_name" text NOT NULL,',
      '  "item" jsonb,',
      '  "username" text,',
      '  "error" text,',
      '  "date" timestamptz NOT NULL',
      ');',
      `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`,
      `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`,
    ].join('\n') + '\n'
  );
}
