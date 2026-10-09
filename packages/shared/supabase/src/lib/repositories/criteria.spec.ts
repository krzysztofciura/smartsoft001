import { DomainValidationError } from '@smartsoft001/domain-core';

import { CriteriaTranslator, quoteIdentifier } from './criteria';

describe('shared-supabase: CriteriaTranslator', () => {
  const plain = new CriteriaTranslator({
    columns: { ownerId: 'owner_id' },
    encrypted: false,
  });
  const encrypted = new CriteriaTranslator({
    columns: { ownerId: 'owner_id' },
    encrypted: true,
  });

  it('should match every row for empty criteria', () => {
    // Arrange
    const criteria = {};

    // Act
    const result = plain.where(criteria);

    // Assert
    expect(result).toEqual({ sql: 'TRUE', params: [] });
  });

  it('should compare a document field as jsonb, also inside arrays', () => {
    // Act
    const result = plain.where({ name: 'Anna' });

    // Assert
    expect(result.sql).toBe(
      `COALESCE(("data" #> '{name}') = $1::jsonb OR (jsonb_typeof(("data" #> '{name}')) = 'array' AND ("data" #> '{name}') @> jsonb_build_array($1::jsonb)), false)`,
    );
    expect(result.params).toEqual(['"Anna"']);
  });

  it('should address nested fields by path and id and columns directly', () => {
    // Act
    const result = plain.where({
      id: 'a1',
      ownerId: 'u1',
      'address.city': { $ne: 'Kraków' },
    });

    // Assert
    expect(result.sql).toContain('"id" = $1');
    expect(result.sql).toContain('"owner_id" = $2');
    expect(result.sql).toContain(
      `NOT (COALESCE(("data" #> '{address,city}') = $3::jsonb`,
    );
    expect(result.params).toEqual(['a1', 'u1', '"Kraków"']);
  });

  it('should continue numbering after already bound parameters', () => {
    // Act
    const result = plain.where({ ownerId: 'u1' }, 3);

    // Assert
    expect(result.sql).toBe('"owner_id" = $4');
  });

  it('should translate comparisons, lists and existence', () => {
    // Act
    const result = plain.where({
      price: { $gte: 10, $lt: 20 },
      status: { $in: ['new', 'paid'] },
      ownerId: { $nin: ['u1'] },
      deletedAt: { $exists: false },
    });

    // Assert
    expect(result.sql).toContain(
      `(("data" #> '{price}') >= $1::jsonb AND ("data" #> '{price}') < $2::jsonb)`,
    );
    expect(result.sql).toContain(
      `OR COALESCE(("data" #> '{status}') = $4::jsonb`,
    );
    expect(result.sql).toContain('NOT (COALESCE("owner_id" = ANY($5), false))');
    expect(result.sql).toContain(`("data" #> '{deletedAt}') IS NULL`);
    expect(result.params).toEqual(['10', '20', '"new"', '"paid"', ['u1']]);
  });

  it('should treat equality with null as missing or null, like MongoDB', () => {
    // Act
    const result = plain.where({ closedAt: null });

    // Assert
    expect(result.sql).toBe(
      `(("data" #> '{closedAt}') IS NULL OR ("data" #> '{closedAt}') = 'null'::jsonb)`,
    );
    expect(result.params).toEqual([]);
  });

  it('should translate $regex with case-insensitive options to a bound POSIX pattern', () => {
    // Act
    const result = plain.where({ name: { $regex: 'an\\.na', $options: 'i' } });

    // Assert
    expect(result.sql).toBe(`("data" #>> '{name}') ~* $1`);
    expect(result.params).toEqual(['an\\.na']);
  });

  it('should combine $or, $and and $nor', () => {
    // Act
    const result = plain.where({ $or: [{ a: 1 }, { b: 2 }], $nor: [{ c: 3 }] });

    // Assert
    expect(result.sql.startsWith('((')).toBe(true);
    expect(result.sql).toContain(' OR ');
    expect(result.sql).toContain('NOT ((');
    expect(result.params).toEqual(['1', '2', '3']);
  });

  it('should compare dates in their stored ISO form', () => {
    // Act
    const result = plain.where({
      createdAt: { $gt: new Date('2026-01-01T00:00:00.000Z') },
    });

    // Assert
    expect(result.params).toEqual(['"2026-01-01T00:00:00.000Z"']);
  });

  it.each([
    [{ $where: 'sleep(1)' }],
    [{ name: { $expr: {} } }],
    [{ 'a;drop': 1 }],
    [{ __proto__x: 1, 'x.__proto__': 1 }],
    [{ name: { $in: 'x' } }],
    [{ name: { $exists: 'yes' } }],
    [{ name: { $gt: { $ne: 1 } } }],
    [{ $or: [] }],
  ])('should refuse unsupported or unsafe criteria %j', (criteria) => {
    // Act & Assert
    expect(() => plain.where(criteria)).toThrow(DomainValidationError);
  });

  it('should refuse filtering an encrypted document by a field that is not a column', () => {
    // Act & Assert
    expect(() => encrypted.where({ name: 'Anna' })).toThrow(
      DomainValidationError,
    );
    expect(encrypted.where({ ownerId: 'u1', id: 'a' }).sql).toBe(
      '"owner_id" = $1 AND "id" = $2',
    );
  });

  it('should build ORDER BY for fields and columns and refuse other directions', () => {
    // Act
    const order = plain.orderBy({ ownerId: 1, 'meta.rank': -1 });

    // Assert
    expect(order).toBe(
      `"owner_id" ASC NULLS LAST, ("data" #> '{meta,rank}') DESC NULLS LAST`,
    );
    expect(() => plain.orderBy({ name: 'random()' })).toThrow(
      DomainValidationError,
    );
  });

  it('should quote only plain lower-case identifiers', () => {
    // Act & Assert
    expect(quoteIdentifier('orders_2026')).toBe('"orders_2026"');
    expect(() => quoteIdentifier('Orders"; DROP')).toThrow(
      DomainValidationError,
    );
  });
});
