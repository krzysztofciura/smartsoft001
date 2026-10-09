import { DomainValidationError } from '@smartsoft001/domain-core';

/**
 * Where a document field lives in the item table: the JSON document (`data`),
 * a plain column declared in `SupabaseConfig.columns`, or the `id` key column.
 */
export interface ISupabaseFieldMap {
  /** Document field (top level) to column name. */
  columns: Record<string, string>;
  /**
   * The document is stored encrypted: only `id` and declared columns can be
   * filtered or sorted, every other field is refused instead of silently
   * matching nothing.
   */
  encrypted: boolean;
}

/** SQL fragment with positional parameters starting at `$<offset + 1>`. */
export interface ISqlFragment {
  sql: string;
  params: unknown[];
}

const FIELD = /^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)*$/;
const FORBIDDEN_PARTS = ['__proto__', 'prototype', 'constructor'];
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const MAX_DEPTH = 8;

const COMPARISON: Record<string, string> = {
  $gt: '>',
  $gte: '>=',
  $lt: '<',
  $lte: '<=',
};

/** Quotes a configured SQL identifier; anything outside `[a-z_][a-z0-9_]*` is refused. */
export function quoteIdentifier(name: string): string {
  if (!IDENTIFIER.test(name))
    throw new DomainValidationError(`Invalid SQL identifier: ${name}`);
  return `"${name}"`;
}

function invalid(message: string): never {
  throw new DomainValidationError(message);
}

/**
 * Translates the subset of MongoDB criteria that the Smartsoft repositories
 * receive (`crud` HTTP queries, specifications and trusted callers) into a
 * parameterized SQL condition over the item table:
 * `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$exists`,
 * `$regex` (with `$options: 'i'`), `$and`, `$or`, `$nor`, dot paths and
 * implicit equality. Field values never become SQL: every value is a bound
 * parameter, and unknown operators (`$where`, `$expr`, …) are refused.
 */
export class CriteriaTranslator {
  constructor(private readonly fields: ISupabaseFieldMap) {}

  /**
   * @param criteria MongoDB-style criteria; empty or missing means "all rows".
   * @param offset Number of parameters already bound before this fragment.
   */
  where(criteria: unknown, offset = 0): ISqlFragment {
    const params: unknown[] = [];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${offset + params.length}`;
    };
    const sql = this.group(criteria ?? {}, bind, 0);
    return { sql: sql || 'TRUE', params };
  }

  /** ORDER BY list for `{ field: 1 | -1 }`; fields are validated like criteria. */
  orderBy(sort: unknown): string {
    if (sort === undefined || sort === null) return '';
    if (typeof sort !== 'object' || Array.isArray(sort))
      invalid('Unsupported sort');
    const parts = Object.entries(sort as Record<string, unknown>).map(
      ([field, direction]) => {
        if (![1, -1, 'asc', 'desc'].includes(direction as never))
          invalid(`Unsupported sort direction for ${field}`);
        const descending = direction === -1 || direction === 'desc';
        return `${this.column(field).sql} ${descending ? 'DESC' : 'ASC'} NULLS LAST`;
      },
    );
    return parts.join(', ');
  }

  private group(
    criteria: unknown,
    bind: (value: unknown) => string,
    depth: number,
  ): string {
    if (depth > MAX_DEPTH) invalid('Criteria nested too deeply');
    if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria))
      invalid('Criteria must be an object');

    const conditions: string[] = [];
    for (const [key, value] of Object.entries(
      criteria as Record<string, unknown>,
    )) {
      if (key === '$and' || key === '$or' || key === '$nor') {
        if (!Array.isArray(value) || !value.length)
          invalid(`${key} needs a non-empty list`);
        const parts = value.map(
          (item) => `(${this.group(item, bind, depth + 1) || 'TRUE'})`,
        );
        if (key === '$and') conditions.push(parts.join(' AND '));
        else if (key === '$or') conditions.push(`(${parts.join(' OR ')})`);
        else conditions.push(`NOT (${parts.join(' OR ')})`);
      } else if (key.startsWith('$')) {
        invalid(`Unsupported operator: ${key}`);
      } else {
        conditions.push(this.field(key, value, bind));
      }
    }
    return conditions.join(' AND ');
  }

  private field(
    key: string,
    value: unknown,
    bind: (value: unknown) => string,
  ): string {
    const target = this.column(key);
    const operators =
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date) &&
      !(value instanceof RegExp) &&
      Object.keys(value).some((k) => k.startsWith('$'))
        ? (value as Record<string, unknown>)
        : { $eq: value };

    const parts: string[] = [];
    for (const [operator, operand] of Object.entries(operators)) {
      if (!operator.startsWith('$'))
        invalid(`Mixed operators and fields under ${key}`);
      switch (operator) {
        case '$eq':
          parts.push(this.equals(target, operand, bind));
          break;
        case '$ne':
          parts.push(`NOT (${this.equals(target, operand, bind)})`);
          break;
        case '$gt':
        case '$gte':
        case '$lt':
        case '$lte':
          parts.push(
            `${target.sql} ${COMPARISON[operator]} ${this.value(target, operand, bind)}`,
          );
          break;
        case '$in':
          parts.push(this.inList(target, operand, bind));
          break;
        case '$nin':
          parts.push(`NOT (${this.inList(target, operand, bind)})`);
          break;
        case '$exists':
          if (typeof operand !== 'boolean') invalid('$exists needs a boolean');
          parts.push(`${target.sql} IS ${operand ? 'NOT ' : ''}NULL`);
          break;
        case '$regex':
          parts.push(this.regex(target, operand, operators['$options'], bind));
          break;
        case '$options':
          if (!('$regex' in operators)) invalid('$options without $regex');
          break;
        default:
          invalid(`Unsupported operator: ${operator}`);
      }
    }
    return parts.length > 1 ? `(${parts.join(' AND ')})` : (parts[0] ?? 'TRUE');
  }

  /**
   * Like MongoDB, equality with `null` also matches a missing field, and
   * equality with a scalar also matches an array that contains it.
   */
  private equals(
    target: IColumn,
    operand: unknown,
    bind: (value: unknown) => string,
  ): string {
    if (operand === null || operand === undefined) {
      return target.json
        ? `(${target.sql} IS NULL OR ${target.sql} = 'null'::jsonb)`
        : `${target.sql} IS NULL`;
    }
    if (!target.json) return `${target.sql} = ${bind(this.plain(operand))}`;
    const parameter = bind(JSON.stringify(this.plain(operand)));
    return `COALESCE(${target.sql} = ${parameter}::jsonb OR (jsonb_typeof(${target.sql}) = 'array' AND ${target.sql} @> jsonb_build_array(${parameter}::jsonb)), false)`;
  }

  private inList(
    target: IColumn,
    operand: unknown,
    bind: (value: unknown) => string,
  ): string {
    if (!Array.isArray(operand)) invalid('$in and $nin need a list');
    if (!operand.length) return 'FALSE';
    if (!target.json)
      return `COALESCE(${target.sql} = ANY(${bind(operand.map((item) => this.plain(item)))}), false)`;
    return `(${operand.map((item) => this.equals(target, item, bind)).join(' OR ')})`;
  }

  private value(
    target: IColumn,
    operand: unknown,
    bind: (value: unknown) => string,
  ): string {
    if (
      operand === null ||
      operand === undefined ||
      (typeof operand === 'object' && !(operand instanceof Date))
    )
      invalid('Comparison needs a scalar value');
    return target.json
      ? `${bind(JSON.stringify(this.plain(operand)))}::jsonb`
      : bind(this.plain(operand));
  }

  private regex(
    target: IColumn,
    pattern: unknown,
    options: unknown,
    bind: (value: unknown) => string,
  ): string {
    const source = pattern instanceof RegExp ? pattern.source : pattern;
    const flags =
      (pattern instanceof RegExp ? pattern.flags : '') +
      (typeof options === 'string' ? options : '');
    if (typeof source !== 'string') invalid('$regex needs a string');
    if (options !== undefined && typeof options !== 'string')
      invalid('$options needs a string');
    if (/[^imsx]/.test(flags.replace(/[gu]/g, '')))
      invalid('Unsupported $regex options');
    const text = target.json ? `(${target.text})` : `${target.sql}::text`;
    return `${text} ${flags.includes('i') ? '~*' : '~'} ${bind(source)}`;
  }

  /** Dates are compared in their JSON (ISO 8601) form, as they are stored. */
  private plain(value: unknown): unknown {
    return value instanceof Date ? value.toISOString() : value;
  }

  private column(key: string): IColumn {
    if (
      !FIELD.test(key) ||
      key.split('.').some((part) => FORBIDDEN_PARTS.includes(part))
    )
      invalid(`Invalid field: ${key}`);
    if (key === 'id') return { sql: '"id"', text: '"id"', json: false };
    const column = this.fields.columns[key];
    if (column) {
      const sql = quoteIdentifier(column);
      return { sql, text: sql, json: false };
    }
    if (this.fields.encrypted)
      invalid(
        `Field ${key} is encrypted: declare it as a column to filter or sort by it`,
      );
    const path = `'{${key.split('.').join(',')}}'`;
    return {
      sql: `("data" #> ${path})`,
      text: `"data" #>> ${path}`,
      json: true,
    };
  }
}

interface IColumn {
  /** SQL expression of the value (jsonb for document fields). */
  sql: string;
  /** SQL expression of the value as text (for `$regex`). */
  text: string;
  /** The value is jsonb from the document, not a typed column. */
  json: boolean;
}
