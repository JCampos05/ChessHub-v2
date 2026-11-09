import { describe, expect, it } from 'vitest';
import {
  isFrozen,
  isRunning,
  parseTournamentStatus,
} from '../../src/modules/tournaments/tournament-status.js';

describe('estados del torneo (RF06)', () => {
  it.each([
    ['convocatoria', 'REGISTRATION_OPEN'],
    ['Inscripciones_Cerradas', 'REGISTRATION_CLOSED'],
    ['en_juego', 'IN_PROGRESS'],
    ['ronda_en_curso', 'ROUND_IN_PROGRESS'],
    ['finalizado', 'FINISHED'],
    ['cancelado', 'CANCELLED'],
    ['IN_PROGRESS', 'IN_PROGRESS'],
    ['1', 'REGISTRATION_OPEN'],
    ['6', 'CANCELLED'],
  ])('traduce %s', (input, expected) => {
    expect(parseTournamentStatus(input)).toBe(expected);
  });

  it.each(['', '0', '7', 'abierto', '1.5'])('rechaza %j', (input) => {
    expect(parseTournamentStatus(input)).toBeUndefined();
  });

  it('clasifica los estados', () => {
    expect(isFrozen('FINISHED')).toBe(true);
    expect(isFrozen('CANCELLED')).toBe(true);
    expect(isFrozen('IN_PROGRESS')).toBe(false);
    expect(isRunning('ROUND_IN_PROGRESS')).toBe(true);
    expect(isRunning('REGISTRATION_OPEN')).toBe(false);
  });
});
