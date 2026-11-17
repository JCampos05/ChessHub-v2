import { describe, expect, it } from 'vitest';
import {
  allowedTransitions,
  decideTransition,
  isTransitionAllowed,
  TOURNAMENT_STATUSES,
  type TournamentState,
  type TransitionFacts,
} from '../../src/domain/state-machines/tournament.js';

// Hechos con los que se cumplen todas las condiciones de la transición dada (sin ronda abierta salvo que haga falta)
const satisfied = (from: TournamentState, to: TournamentState): TransitionFacts => {
  const needsOpenRound =
    (from === 'IN_PROGRESS' && to === 'ROUND_IN_PROGRESS') || (from === 'ROUND_IN_PROGRESS' && to === 'IN_PROGRESS');
  return {
    activeRegistrations: 4,
    roundsPlanned: 3,
    finishedRounds: to === 'FINISHED' ? 3 : 0,
    openRound: needsOpenRound ? { status: 'IN_PROGRESS', pairings: 2, pendingGames: 0 } : null,
  };
};

const base: TransitionFacts = { activeRegistrations: 4, roundsPlanned: 3, finishedRounds: 0, openRound: null };
const withRound = (round: Partial<NonNullable<TransitionFacts['openRound']>> = {}): TransitionFacts => ({
  ...base,
  openRound: { status: 'IN_PROGRESS', pairings: 2, pendingGames: 0, ...round },
});

// Fuente independiente de la implementación: las únicas diez transiciones permitidas 
const VALID = new Set([
  'REGISTRATION_OPEN>REGISTRATION_CLOSED',
  'REGISTRATION_CLOSED>REGISTRATION_OPEN',
  'REGISTRATION_CLOSED>IN_PROGRESS',
  'IN_PROGRESS>ROUND_IN_PROGRESS',
  'ROUND_IN_PROGRESS>IN_PROGRESS',
  'IN_PROGRESS>FINISHED',
  'REGISTRATION_OPEN>CANCELLED',
  'REGISTRATION_CLOSED>CANCELLED',
  'IN_PROGRESS>CANCELLED',
  'ROUND_IN_PROGRESS>CANCELLED',
]);

describe('máquina de estados del torneo (RF19, RF20)', () => {
  it('[RF19] los estados siguen el orden del ciclo de vida', () => {
    expect([...TOURNAMENT_STATUSES]).toEqual([
      'REGISTRATION_OPEN',
      'REGISTRATION_CLOSED',
      'IN_PROGRESS',
      'ROUND_IN_PROGRESS',
      'FINISHED',
      'CANCELLED',
    ]);
  });

  describe('tabla de las 36 combinaciones origen/destino', () => {
    const pairs = TOURNAMENT_STATUSES.flatMap((from) => TOURNAMENT_STATUSES.map((to) => [from, to] as const));

    it('[RF20] hay exactamente 36 combinaciones y 10 válidas', () => {
      expect(pairs).toHaveLength(36);
      expect(pairs.filter(([from, to]) => VALID.has(`${from}>${to}`))).toHaveLength(10);
    });

    it.each(pairs)('[RF20] %s → %s', (from, to) => {
      const valid = VALID.has(`${from}>${to}`);
      expect(isTransitionAllowed(from, to)).toBe(valid);

      if (valid) {
        expect(decideTransition(from, to, satisfied(from, to)).ok).toBe(true);
        return;
      }
      // Una transición no permitida se rechaza aunque los hechos sean favorables
      for (const facts of [base, withRound(), satisfied(from, to)]) {
        const decision = decideTransition(from, to, facts);
        expect(decision).toMatchObject({ ok: false, code: 'INVALID_STATE_TRANSITION' });
      }
    });

    it('[RF20] cada estado origen tiene al menos una transición inválida', () => {
      for (const from of TOURNAMENT_STATUSES) {
        const invalid = TOURNAMENT_STATUSES.filter((to) => !isTransitionAllowed(from, to));
        expect(invalid.length, from).toBeGreaterThan(0);
      }
    });

    it('[RF20] pasar al mismo estado nunca es válido', () => {
      for (const state of TOURNAMENT_STATUSES) expect(isTransitionAllowed(state, state)).toBe(false);
    });

    it('[RF20] finalizado y cancelado son finales: no tienen salida', () => {
      expect(allowedTransitions('FINISHED')).toEqual([]);
      expect(allowedTransitions('CANCELLED')).toEqual([]);
      for (const to of TOURNAMENT_STATUSES) {
        expect(decideTransition('FINISHED', to, satisfied('FINISHED', to)).ok).toBe(false);
        expect(decideTransition('CANCELLED', to, satisfied('CANCELLED', to)).ok).toBe(false);
      }
    });

    it('[RF20] cancelar es posible desde cualquier estado no final, sin condiciones', () => {
      const none: TransitionFacts = { activeRegistrations: 0, roundsPlanned: null, finishedRounds: 0, openRound: null };
      for (const from of ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS', 'ROUND_IN_PROGRESS'] as const) {
        expect(decideTransition(from, 'CANCELLED', none)).toEqual({ ok: true, roundEffect: 'NONE' });
      }
    });
  });

  describe('condiciones y efectos', () => {
    it('[RF19] abrir y cerrar inscripciones no exigen nada ni tocan rondas', () => {
      expect(decideTransition('REGISTRATION_OPEN', 'REGISTRATION_CLOSED', base)).toEqual({ ok: true, roundEffect: 'NONE' });
      expect(decideTransition('REGISTRATION_CLOSED', 'REGISTRATION_OPEN', base)).toEqual({ ok: true, roundEffect: 'NONE' });
    });

    it.each([0, 1])('[RN-04] iniciar el torneo con %i inscripciones activas falla por condición', (count) => {
      const decision = decideTransition('REGISTRATION_CLOSED', 'IN_PROGRESS', { ...base, activeRegistrations: count });
      expect(decision).toMatchObject({ ok: false, code: 'STATE_PRECONDITION_FAILED' });
      if (!decision.ok) expect(decision.message).toMatch(/2 inscripciones/);
    });

    it('[RN-04] con 2 inscripciones activas se puede iniciar', () => {
      expect(decideTransition('REGISTRATION_CLOSED', 'IN_PROGRESS', { ...base, activeRegistrations: 2 })).toEqual({
        ok: true,
        roundEffect: 'NONE',
      });
    });

    it('[RF20] iniciar una ronda sin ronda abierta falla por condición', () => {
      const decision = decideTransition('IN_PROGRESS', 'ROUND_IN_PROGRESS', base);
      expect(decision).toMatchObject({ ok: false, code: 'STATE_PRECONDITION_FAILED' });
      if (!decision.ok) expect(decision.message).toMatch(/ronda/);
    });

    it('[RF20] iniciar una ronda sin mesas falla por condición', () => {
      expect(decideTransition('IN_PROGRESS', 'ROUND_IN_PROGRESS', withRound({ pairings: 0 }))).toMatchObject({
        ok: false,
        code: 'STATE_PRECONDITION_FAILED',
      });
    });

    it('[RF20] una ronda pendiente se arranca; una ya en curso no necesita efecto', () => {
      expect(decideTransition('IN_PROGRESS', 'ROUND_IN_PROGRESS', withRound({ status: 'PENDING' }))).toEqual({
        ok: true,
        roundEffect: 'START_ROUND',
      });
      expect(decideTransition('IN_PROGRESS', 'ROUND_IN_PROGRESS', withRound({ status: 'IN_PROGRESS' }))).toEqual({
        ok: true,
        roundEffect: 'NONE',
      });
    });

    it('[RF20] cerrar la ronda con partidas pendientes falla por condición', () => {
      const decision = decideTransition('ROUND_IN_PROGRESS', 'IN_PROGRESS', withRound({ pendingGames: 1 }));
      expect(decision).toMatchObject({ ok: false, code: 'STATE_PRECONDITION_FAILED' });
      if (!decision.ok) expect(decision.message).toMatch(/pendientes/);
    });

    it('[RF20] cerrar la ronda sin partidas pendientes la termina', () => {
      expect(decideTransition('ROUND_IN_PROGRESS', 'IN_PROGRESS', withRound({ pendingGames: 0 }))).toEqual({
        ok: true,
        roundEffect: 'CLOSE_ROUND',
      });
    });

    it('[RF20] sin ronda abierta, volver a «en juego» se permite sin efecto (evita dejar el torneo atascado)', () => {
      expect(decideTransition('ROUND_IN_PROGRESS', 'IN_PROGRESS', base)).toEqual({ ok: true, roundEffect: 'NONE' });
    });

    describe('finalizar', () => {
      it('con una ronda abierta falla por condición', () => {
        const facts = { ...withRound(), finishedRounds: 3 };
        expect(decideTransition('IN_PROGRESS', 'FINISHED', facts)).toMatchObject({
          ok: false,
          code: 'STATE_PRECONDITION_FAILED',
        });
      });

      it('sin ninguna ronda terminada falla por condición', () => {
        expect(decideTransition('IN_PROGRESS', 'FINISHED', { ...base, finishedRounds: 0 })).toMatchObject({
          ok: false,
          code: 'STATE_PRECONDITION_FAILED',
        });
      });

      it('con menos rondas terminadas que las planeadas falla y el mensaje las cuenta', () => {
        const decision = decideTransition('IN_PROGRESS', 'FINISHED', { ...base, finishedRounds: 2 });
        expect(decision).toMatchObject({ ok: false, code: 'STATE_PRECONDITION_FAILED' });
        if (!decision.ok) expect(decision.message).toMatch(/2 de 3/);
      });

      it('con todas las rondas planeadas terminadas se permite', () => {
        expect(decideTransition('IN_PROGRESS', 'FINISHED', { ...base, finishedRounds: 3 })).toEqual({
          ok: true,
          roundEffect: 'NONE',
        });
      });

      it('con más rondas terminadas que las planeadas también se permite', () => {
        expect(decideTransition('IN_PROGRESS', 'FINISHED', { ...base, finishedRounds: 4 }).ok).toBe(true);
      });

      it('sin rondas planeadas basta una terminada y ninguna abierta (P-44)', () => {
        const facts = { ...base, roundsPlanned: null, finishedRounds: 1 };
        expect(decideTransition('IN_PROGRESS', 'FINISHED', facts).ok).toBe(true);
        expect(decideTransition('IN_PROGRESS', 'FINISHED', { ...facts, finishedRounds: 0 }).ok).toBe(false);
      });
    });

    it('[RF20] los mensajes de rechazo son texto en español no vacío', () => {
      const invalid = decideTransition('FINISHED', 'REGISTRATION_OPEN', base);
      const precondition = decideTransition('REGISTRATION_CLOSED', 'IN_PROGRESS', { ...base, activeRegistrations: 0 });
      for (const decision of [invalid, precondition]) {
        expect(decision.ok).toBe(false);
        if (!decision.ok) expect(decision.message.length).toBeGreaterThan(10);
      }
    });

    it('[RF20] es determinista: los mismos hechos dan la misma decisión', () => {
      const facts = withRound({ status: 'PENDING' });
      expect(decideTransition('IN_PROGRESS', 'ROUND_IN_PROGRESS', facts)).toEqual(
        decideTransition('IN_PROGRESS', 'ROUND_IN_PROGRESS', facts),
      );
    });
  });
});
