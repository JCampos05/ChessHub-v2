import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { calendarDateSchema, fromDateOnly, toDateOnly } from '../../src/shared/dates.js';
import { buildMeta, listQueryShape, toSkipTake } from '../../src/shared/pagination.js';

const schema = z.object(listQueryShape(['id', 'name', 'createdAt'] as const, 'createdAt'));

describe('listados paginados (RNF08)', () => {
  it('aplica valores por omisión', () => {
    const parsed = schema.parse({});
    expect(parsed).toEqual({ page: 1, limit: 20, sortBy: 'createdAt', order: 'desc', includeInactive: false });
  });

  it('acepta order en mayúsculas y convierte los números', () => {
    const parsed = schema.parse({ page: '2', limit: '10', sortBy: 'id', order: 'DESC' });
    expect(parsed).toMatchObject({ page: 2, limit: 10, sortBy: 'id', order: 'desc' });
  });

  it.each([
    { page: '0' },
    { limit: '101' },
    { limit: 'abc' },
    { sortBy: 'password' },
    { order: 'arriba' },
    { includeInactive: 'si' },
  ])('rechaza %o', (query) => {
    expect(schema.safeParse(query).success).toBe(false);
  });

  it('interpreta includeInactive', () => {
    expect(schema.parse({ includeInactive: 'true' }).includeInactive).toBe(true);
    expect(schema.parse({ includeInactive: 'false' }).includeInactive).toBe(false);
  });

  it('calcula la metainformación y el desplazamiento', () => {
    expect(buildMeta(2, 10, 25)).toEqual({ page: 2, limit: 10, total: 25, totalPages: 3 });
    expect(buildMeta(1, 10, 0).totalPages).toBe(1);
    expect(toSkipTake(3, 10)).toEqual({ skip: 20, take: 10 });
  });
});

describe('fechas de calendario (RNF08)', () => {
  it('acepta una fecha real', () => {
    expect(calendarDateSchema.safeParse('2026-11-08').success).toBe(true);
  });

  it.each(['2026-02-31', '2026-13-01', '08/11/2026', '2026-1-1', '', 'hoy'])('rechaza %s', (value) => {
    expect(calendarDateSchema.safeParse(value).success).toBe(false);
  });

  it('convierte de ida y vuelta sin perder el día', () => {
    expect(fromDateOnly(toDateOnly('2026-11-08'))).toBe('2026-11-08');
  });
});
