import { stateLabel, type TournamentState } from '../../domain/state-machines/tournament.js';

export const NOTIFICATION_TYPE_STATE_CHANGED = 'TOURNAMENT_STATE_CHANGED';

export interface StateChangeInput {
  tournamentId: string;
  tournamentName: string;
  changeId: string;
  from: TournamentState;
  to: TournamentState;
  reason?: string | null | undefined;
}

export interface NotificationContent {
  type: typeof NOTIFICATION_TYPE_STATE_CHANGED;
  title: string;
  body: string;
  // Solo identificadores y estados: nunca datos de contacto de jugadores 
  data: { tournamentId: string; changeId: string; from: TournamentState; to: TournamentState; reason?: string };
}

// Una sola notificación por cambio y usuario: un reintento del trabajador no duplica filas
export const stateChangeDedupeKey = (changeId: string): string => `state_change:${changeId}`;

function describe(input: StateChangeInput): string {
  const name = `«${input.tournamentName}»`;
  switch (input.to) {
    case 'REGISTRATION_CLOSED':
      return `Se cerraron las inscripciones del torneo ${name}.`;
    case 'REGISTRATION_OPEN':
      return `Se reabrió la convocatoria del torneo ${name}.`;
    case 'IN_PROGRESS':
      return input.from === 'ROUND_IN_PROGRESS'
        ? `Terminó la ronda en curso del torneo ${name}; el torneo vuelve a estar en juego.`
        : `El torneo ${name} comenzó.`;
    case 'ROUND_IN_PROGRESS':
      return `Inició la ronda del torneo ${name}.`;
    case 'FINISHED':
      return `El torneo ${name} finalizó.`;
    case 'CANCELLED':
      return `El torneo ${name} fue cancelado.`;
  }
}

// Texto de la notificación de bandeja (y del correo) de un cambio de estado del torneo
export function stateChangeMessage(input: StateChangeInput): NotificationContent {
  const reason = input.reason?.trim() ? input.reason.trim() : undefined;
  const body = reason === undefined ? describe(input) : `${describe(input)} Motivo: ${reason}`;

  return {
    type: NOTIFICATION_TYPE_STATE_CHANGED,
    title: `Torneo «${input.tournamentName}»: de ${stateLabel(input.from)} a ${stateLabel(input.to)}`,
    body,
    data: {
      tournamentId: input.tournamentId,
      changeId: input.changeId,
      from: input.from,
      to: input.to,
      ...(reason === undefined ? {} : { reason }),
    },
  };
}
