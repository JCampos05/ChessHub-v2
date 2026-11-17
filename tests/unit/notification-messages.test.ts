import { describe, expect, it } from 'vitest';
import { TOURNAMENT_STATUSES, type TournamentState } from '../../src/domain/state-machines/tournament.js';
import {
  NOTIFICATION_TYPE_STATE_CHANGED,
  stateChangeDedupeKey,
  stateChangeMessage,
} from '../../src/modules/notifications/notification.messages.js';

const input = (from: TournamentState, to: TournamentState, reason?: string | null) => ({
  tournamentId: '0192f0aa-0000-7000-8000-000000000001',
  tournamentName: 'Abierto de Primavera',
  changeId: '0192f0aa-0000-7000-8000-0000000000c1',
  from,
  to,
  reason,
});

describe('mensajes de cambio de estado (RF23)', () => {
  it('[RF23] el título nombra el torneo y los dos estados', () => {
    const message = stateChangeMessage(input('REGISTRATION_OPEN', 'REGISTRATION_CLOSED'));

    expect(message.type).toBe(NOTIFICATION_TYPE_STATE_CHANGED);
    expect(message.title).toBe('Torneo «Abierto de Primavera»: de convocatoria a inscripciones cerradas');
  });

  it.each([
    ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED', /Se cerraron las inscripciones/],
    ['REGISTRATION_CLOSED', 'REGISTRATION_OPEN', /Se reabrió la convocatoria/],
    ['REGISTRATION_CLOSED', 'IN_PROGRESS', /comenzó/],
    ['IN_PROGRESS', 'ROUND_IN_PROGRESS', /Inició la ronda/],
    ['ROUND_IN_PROGRESS', 'IN_PROGRESS', /Terminó la ronda/],
    ['IN_PROGRESS', 'FINISHED', /finalizó/],
    ['REGISTRATION_OPEN', 'CANCELLED', /fue cancelado/],
    ['ROUND_IN_PROGRESS', 'CANCELLED', /fue cancelado/],
  ] as const)('[RF23] cuerpo de %s → %s', (from, to, expected) => {
    const { body } = stateChangeMessage(input(from, to));

    expect(body).toMatch(expected);
    expect(body).toContain('Abierto de Primavera');
  });

  it('[RF23] agrega el motivo cuando existe y lo omite cuando no', () => {
    const withReason = stateChangeMessage(input('IN_PROGRESS', 'CANCELLED', 'Falta de sede'));
    expect(withReason.body).toMatch(/Motivo: Falta de sede\.?$/);
    expect(withReason.data.reason).toBe('Falta de sede');

    for (const reason of [undefined, null, '', '   ']) {
      const without = stateChangeMessage(input('IN_PROGRESS', 'CANCELLED', reason));
      expect(without.body).not.toMatch(/Motivo/);
      expect(without.data).not.toHaveProperty('reason');
    }
  });

  it('[RF23] los datos llevan solo identificadores y estados, sin contacto', () => {
    const { data } = stateChangeMessage(input('REGISTRATION_CLOSED', 'IN_PROGRESS'));

    expect(data).toEqual({
      tournamentId: '0192f0aa-0000-7000-8000-000000000001',
      changeId: '0192f0aa-0000-7000-8000-0000000000c1',
      from: 'REGISTRATION_CLOSED',
      to: 'IN_PROGRESS',
    });
  });

  it('[RF23, C-15] ningún texto generado contiene correos ni teléfonos', () => {
    for (const from of TOURNAMENT_STATUSES) {
      for (const to of TOURNAMENT_STATUSES) {
        const message = stateChangeMessage(input(from, to));
        const readable = `${message.title} ${message.body}`;
        expect(`${readable} ${JSON.stringify(message.data)}`).not.toMatch(/@/);
        // Los identificadores de los datos son UUID con tramos largos de dígitos; el teléfono solo se busca en el texto
        expect(readable).not.toMatch(/\d{7,}/);
      }
    }
  });

  it('[RF23] cualquier par de estados produce título y cuerpo no vacíos', () => {
    for (const from of TOURNAMENT_STATUSES) {
      for (const to of TOURNAMENT_STATUSES) {
        const message = stateChangeMessage(input(from, to));
        expect(message.title.length).toBeGreaterThan(0);
        expect(message.body.length).toBeGreaterThan(0);
      }
    }
  });

  it('[RF22] la clave de idempotencia depende solo del cambio', () => {
    expect(stateChangeDedupeKey('abc')).toBe('state_change:abc');
    expect(stateChangeDedupeKey('abc')).toBe(stateChangeDedupeKey('abc'));
    expect(stateChangeDedupeKey('abc')).not.toBe(stateChangeDedupeKey('abd'));
  });
});
