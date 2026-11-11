import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { csvList, MAX_LIST_VALUES } from '../../src/shared/query-lists.js';

const status = csvList(z.enum(['PENDING', 'ACTIVE', 'INACTIVE']));

describe('csvList (RF12)', () => {
  it('separa por comas y valida cada valor', () => {
    expect(status.parse('ACTIVE,PENDING')).toEqual(['ACTIVE', 'PENDING']);
  });

  it('un solo valor da un arreglo de uno', () => {
    expect(status.parse('ACTIVE')).toEqual(['ACTIVE']);
  });

  it('ignora espacios, vacíos y repetidos', () => {
    expect(status.parse(' ACTIVE , ,PENDING,ACTIVE,')).toEqual(['ACTIVE', 'PENDING']);
  });

  it('acepta el parámetro repetido (arreglo)', () => {
    expect(status.parse(['ACTIVE', 'PENDING,INACTIVE'])).toEqual(['ACTIVE', 'PENDING', 'INACTIVE']);
  });

  it('rechaza un valor fuera del catálogo', () => {
    const result = status.safeParse('ACTIVE,NOPE');
    expect(result.success).toBe(false);
  });

  it('rechaza una lista vacía', () => {
    expect(status.safeParse('').success).toBe(false);
    expect(status.safeParse(' , ,').success).toBe(false);
  });

  it('admite exactamente el máximo y rechaza uno más', () => {
    const text = csvList(z.string());
    const ok = Array.from({ length: MAX_LIST_VALUES }, (_, i) => `v${i}`).join(',');
    const tooMany = `${ok},extra`;
    expect(text.parse(ok)).toHaveLength(MAX_LIST_VALUES);
    expect(text.safeParse(tooMany).success).toBe(false);
  });

  it('los repetidos no cuentan para el máximo', () => {
    const text = csvList(z.string(), 2);
    expect(text.parse('a,a,a,b')).toEqual(['a', 'b']);
  });

  it('elimina valores que resultan iguales tras transformarse', () => {
    const upper = csvList(z.string().toUpperCase());
    expect(upper.parse('mex,MEX,usa')).toEqual(['MEX', 'USA']);
  });
});
