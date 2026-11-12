import { describe, expect, it } from 'vitest';
import { ageOn, birthDateBounds, shiftYears } from '../../src/domain/age/age.js';

describe('shiftYears', () => {
  it('resta años conservando mes y día', () => {
    expect(shiftYears('2026-11-10', 5)).toBe('2021-11-10');
  });

  it('el 29 de febrero cae el 28 si el año resultante no es bisiesto', () => {
    expect(shiftYears('2028-02-29', 1)).toBe('2027-02-28');
    expect(shiftYears('2028-02-29', 4)).toBe('2024-02-29');
  });
});

describe('ageOn (años cumplidos)', () => {
  it('antes y después del cumpleaños', () => {
    expect(ageOn('2010-11-11', '2026-11-10')).toBe(15);
    expect(ageOn('2010-11-10', '2026-11-10')).toBe(16);
    expect(ageOn('2010-01-01', '2026-11-10')).toBe(16);
  });

  it('un recién nacido tiene cero años', () => {
    expect(ageOn('2026-11-10', '2026-11-10')).toBe(0);
  });

  it('nacido el 29 de febrero cumple en 1 de marzo los años no bisiestos', () => {
    expect(ageOn('2024-02-29', '2025-02-28')).toBe(0);
    expect(ageOn('2024-02-29', '2025-03-01')).toBe(1);
    expect(ageOn('2024-02-29', '2028-02-29')).toBe(4);
  });
});

describe('birthDateBounds', () => {
  const today = '2026-11-10';

  it('sin rango no hay límites', () => {
    expect(birthDateBounds(today, {})).toEqual({});
  });

  it('edad mínima y máxima', () => {
    expect(birthDateBounds(today, { min: 10, max: 12 })).toEqual({ onOrBefore: '2016-11-10', after: '2013-11-10' });
  });

  // Los límites deben coincidir exactamente con ageOn en las fechas de cumpleaños
  it.each([
    ['2016-11-10', 10],
    ['2016-11-11', 9],
    ['2013-11-10', 13],
    ['2013-11-11', 12],
  ])('nacido el %s tiene %i años y cae del lado correcto del rango 10-12', (birth, age) => {
    expect(ageOn(birth, today)).toBe(age);
    const { onOrBefore, after } = birthDateBounds(today, { min: 10, max: 12 });
    const inRange = birth <= (onOrBefore as string) && birth > (after as string);
    expect(inRange).toBe(age >= 10 && age <= 12);
  });
});
