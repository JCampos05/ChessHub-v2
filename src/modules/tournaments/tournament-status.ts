// Estados del torneo en el orden del ciclo de vida
export const TOURNAMENT_STATUSES = [
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'IN_PROGRESS',
  'ROUND_IN_PROGRESS',
  'FINISHED',
  'CANCELLED',
] as const;

export type TournamentStatusCode = (typeof TOURNAMENT_STATUSES)[number];

const SPANISH_NAMES: Readonly<Record<string, TournamentStatusCode>> = {
  convocatoria: 'REGISTRATION_OPEN',
  inscripciones_cerradas: 'REGISTRATION_CLOSED',
  en_juego: 'IN_PROGRESS',
  ronda_en_curso: 'ROUND_IN_PROGRESS',
  finalizado: 'FINISHED',
  cancelado: 'CANCELLED',
};

// Acepta el código (REGISTRATION_OPEN), el nombre en español (en_juego) o la posición del ciclo (1 a 6)
export function parseTournamentStatus(value: string): TournamentStatusCode | undefined {
  const normalized = value.trim().toLowerCase();
  const byName = SPANISH_NAMES[normalized];
  if (byName) return byName;

  const byCode = TOURNAMENT_STATUSES.find((code) => code.toLowerCase() === normalized);
  if (byCode) return byCode;

  if (/^[1-6]$/.test(normalized)) return TOURNAMENT_STATUSES[Number(normalized) - 1];
  return undefined;
}

// Un torneo terminado o cancelado ya no se modifica
export const isFrozen = (status: string): boolean => status === 'FINISHED' || status === 'CANCELLED';

// Un torneo en juego no puede darse de baja
export const isRunning = (status: string): boolean => status === 'IN_PROGRESS' || status === 'ROUND_IN_PROGRESS';
