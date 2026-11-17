// Estados del torneo en el orden del ciclo de vida
export const TOURNAMENT_STATUSES = [
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'IN_PROGRESS',
  'ROUND_IN_PROGRESS',
  'FINISHED',
  'CANCELLED',
] as const;

export type TournamentState = (typeof TOURNAMENT_STATUSES)[number];

// Nombre con el que se menciona cada estado en los mensajes
const LABELS: Readonly<Record<TournamentState, string>> = {
  REGISTRATION_OPEN: 'convocatoria',
  REGISTRATION_CLOSED: 'inscripciones cerradas',
  IN_PROGRESS: 'en juego',
  ROUND_IN_PROGRESS: 'ronda en curso',
  FINISHED: 'finalizado',
  CANCELLED: 'cancelado',
};

// Transiciones permitidas; los estados finales no tienen salida
const TRANSITIONS: Readonly<Record<TournamentState, readonly TournamentState[]>> = {
  REGISTRATION_OPEN: ['REGISTRATION_CLOSED', 'CANCELLED'],
  REGISTRATION_CLOSED: ['REGISTRATION_OPEN', 'IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['ROUND_IN_PROGRESS', 'FINISHED', 'CANCELLED'],
  ROUND_IN_PROGRESS: ['IN_PROGRESS', 'CANCELLED'],
  FINISHED: [],
  CANCELLED: [],
};

export const allowedTransitions = (from: TournamentState): readonly TournamentState[] => TRANSITIONS[from];

export const isTransitionAllowed = (from: TournamentState, to: TournamentState): boolean =>
  TRANSITIONS[from].includes(to);

// Lo que el servicio lee de la base, con el torneo bloqueado, para que la regla decida sin tocar datos
export interface TransitionFacts {
  activeRegistrations: number;
  roundsPlanned: number | null;
  finishedRounds: number;
  // Ronda activa de mayor número que no está terminada; null si no hay
  openRound: { status: 'PENDING' | 'IN_PROGRESS'; pairings: number; pendingGames: number } | null;
}

export type RoundEffect = 'START_ROUND' | 'CLOSE_ROUND' | 'NONE';

export type TransitionDecision =
  | { ok: true; roundEffect: RoundEffect }
  | { ok: false; code: 'INVALID_STATE_TRANSITION' | 'STATE_PRECONDITION_FAILED'; message: string };

const MIN_PLAYERS = 2;

const accepted = (roundEffect: RoundEffect = 'NONE'): TransitionDecision => ({ ok: true, roundEffect });

const precondition = (message: string): TransitionDecision => ({
  ok: false,
  code: 'STATE_PRECONDITION_FAILED',
  message,
});

// Decide si el torneo puede pasar de un estado a otro y qué debe ocurrirle a la ronda abierta (P-44)
export function decideTransition(from: TournamentState, to: TournamentState, facts: TransitionFacts): TransitionDecision {
  if (!isTransitionAllowed(from, to)) {
    const reason = TRANSITIONS[from].length === 0 ? `«${LABELS[from]}» es un estado final` : 'esa transición no está permitida';
    return {
      ok: false,
      code: 'INVALID_STATE_TRANSITION',
      message: `El torneo no puede pasar de «${LABELS[from]}» a «${LABELS[to]}»: ${reason}`,
    };
  }

  if (from === 'REGISTRATION_CLOSED' && to === 'IN_PROGRESS') {
    if (facts.activeRegistrations < MIN_PLAYERS) {
      return precondition(
        `Se necesitan al menos ${MIN_PLAYERS} inscripciones activas para iniciar el torneo (hay ${facts.activeRegistrations})`,
      );
    }
    return accepted();
  }

  if (from === 'IN_PROGRESS' && to === 'ROUND_IN_PROGRESS') {
    const round = facts.openRound;
    if (round === null) return precondition('No hay una ronda por iniciar: genera la ronda primero');
    if (round.pairings === 0) return precondition('La ronda no tiene mesas: no se puede iniciar');
    return accepted(round.status === 'PENDING' ? 'START_ROUND' : 'NONE');
  }

  if (from === 'ROUND_IN_PROGRESS' && to === 'IN_PROGRESS') {
    const round = facts.openRound;
    if (round === null) return accepted();
    if (round.pendingGames > 0) {
      return precondition(`La ronda tiene ${round.pendingGames} partidas pendientes de resultado`);
    }
    return accepted('CLOSE_ROUND');
  }

  if (from === 'IN_PROGRESS' && to === 'FINISHED') {
    if (facts.openRound !== null) return precondition('Hay una ronda sin terminar: ciérrala antes de finalizar el torneo');
    if (facts.finishedRounds === 0) return precondition('El torneo no tiene ninguna ronda terminada');
    if (facts.roundsPlanned !== null && facts.finishedRounds < facts.roundsPlanned) {
      return precondition(`Solo hay ${facts.finishedRounds} de ${facts.roundsPlanned} rondas planeadas terminadas`);
    }
    return accepted();
  }

  // Abrir y cerrar inscripciones y cancelar no exigen condiciones
  return accepted();
}
