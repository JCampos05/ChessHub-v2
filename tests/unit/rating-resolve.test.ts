import { describe, expect, it } from 'vitest';
import {
  currentRatings,
  resolveRating,
  type RatingPreference,
  type RatingRecord,
} from '../../src/domain/ratings/resolve.js';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const asOf = day('2026-11-15');

const record = (
  system: RatingRecord['system'],
  pace: RatingRecord['pace'],
  value: number,
  validFrom = '2026-01-01',
  stateCode: string | null = null,
): RatingRecord => ({ system, pace, value, validFrom: day(validFrom), stateCode });

const prefer = (
  system: RatingPreference['system'],
  pace: RatingPreference['pace'] = 'STANDARD',
  stateCode: string | null = null,
): RatingPreference => ({ system, pace, stateCode });

describe('rating vigente (P-41)', () => {
  it('toma el de mayor vigencia que no sea futura', () => {
    const records = [
      record('FIDE', 'STANDARD', 1500, '2026-01-01'),
      record('FIDE', 'STANDARD', 1550, '2026-06-01'),
      record('FIDE', 'STANDARD', 1700, '2027-01-01'),
    ];
    expect(currentRatings(records, asOf).map((r) => r.value)).toEqual([1550]);
  });

  it('conserva un valor por sistema, ritmo y estado', () => {
    const records = [
      record('FIDE', 'STANDARD', 1500),
      record('FIDE', 'RAPID', 1450),
      record('STATE', 'STANDARD', 1400, '2026-01-01', 'SIN'),
      record('STATE', 'STANDARD', 1380, '2026-01-01', 'JAL'),
    ];
    expect(currentRatings(records, asOf)).toHaveLength(4);
  });
});

describe('resolución del rating de un torneo (P-41)', () => {
  const all = [
    record('FIDE', 'STANDARD', 1800),
    record('NATIONAL', 'STANDARD', 1700),
    record('STATE', 'STANDARD', 1600, '2026-01-01', 'SIN'),
    record('NATIONAL', 'RAPID', 1650),
    record('FIDE', 'BLITZ', 1900),
  ];

  it('usa el sistema preferido en el ritmo del torneo', () => {
    expect(resolveRating(all, prefer('NATIONAL'), asOf)).toMatchObject({ value: 1700, system: 'NATIONAL', source: 'RECORD' });
    expect(resolveRating(all, prefer('FIDE', 'BLITZ'), asOf)?.value).toBe(1900);
    expect(resolveRating(all, prefer('STATE', 'STANDARD', 'SIN'), asOf)).toMatchObject({ value: 1600, stateCode: 'SIN' });
  });

  it('si falta el preferido, respalda en FIDE, luego nacional y luego estatal', () => {
    // Rápido: solo hay nacional, aunque se prefiera el estatal
    expect(resolveRating(all, prefer('STATE', 'RAPID'), asOf)).toMatchObject({ value: 1650, system: 'NATIONAL' });
    // Se prefiere el estatal de otro estado: se respalda en FIDE
    expect(resolveRating(all, prefer('STATE', 'STANDARD', 'JAL'), asOf)).toMatchObject({ value: 1800, system: 'FIDE' });
    // Sin FIDE ni nacional, el estatal sirve de respaldo para quien prefiere FIDE
    const onlyState = [record('STATE', 'STANDARD', 1600, '2026-01-01', 'SIN')];
    expect(resolveRating(onlyState, prefer('FIDE'), asOf)).toMatchObject({ value: 1600, system: 'STATE' });
  });

  it('nunca mezcla ritmos', () => {
    const rapidOnly = [record('FIDE', 'RAPID', 1700)];
    expect(resolveRating(rapidOnly, prefer('FIDE', 'STANDARD'), asOf)).toBeNull();
    expect(resolveRating(rapidOnly, prefer('FIDE', 'BLITZ'), asOf, 1500)).toBeNull();
  });

  it('sin estado preferido toma el estatal más reciente y, a igualdad, el de código menor', () => {
    const states = [
      record('STATE', 'STANDARD', 1300, '2026-01-01', 'SIN'),
      record('STATE', 'STANDARD', 1350, '2026-05-01', 'JAL'),
      record('STATE', 'STANDARD', 1360, '2026-05-01', 'COL'),
    ];
    expect(resolveRating(states, prefer('STATE'), asOf)?.stateCode).toBe('COL');
  });

  it('ignora un valor con vigencia futura', () => {
    const future = [record('FIDE', 'STANDARD', 1900, '2027-01-01'), record('NATIONAL', 'STANDARD', 1700)];
    expect(resolveRating(future, prefer('FIDE'), asOf)).toMatchObject({ value: 1700, system: 'NATIONAL' });
  });

  it('respalda en la columna anterior solo en ritmo estándar', () => {
    expect(resolveRating([], prefer('FIDE'), asOf, 1500)).toMatchObject({ value: 1500, source: 'LEGACY' });
    expect(resolveRating([], prefer('FIDE', 'RAPID'), asOf, 1500)).toBeNull();
  });

  it('los registros tienen prioridad sobre la columna anterior', () => {
    expect(resolveRating(all, prefer('FIDE'), asOf, 1500)).toMatchObject({ value: 1800, source: 'RECORD' });
  });

  it('sin nada devuelve null', () => {
    expect(resolveRating([], prefer('FIDE'), asOf)).toBeNull();
  });
});
