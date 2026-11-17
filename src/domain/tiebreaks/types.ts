// Una partida jugada con resultado desde el punto de vista de un jugador
export interface PlayedGame {
  opponentId: string;
  points: 0 | 0.5 | 1;
  color: 'W' | 'B';
}

export interface PlayerStats {
  games: PlayedGame[];
  // Suma de los puntajes acumulados tras cada ronda
  progressive: number;
}

export const emptyStats = (): PlayerStats => ({ games: [], progressive: 0 });

// Puntos totales de cada jugador, por id
export type ScoreMap = ReadonlyMap<string, number>;

// Un desempate que se calcula para un jugador a partir de su historial y los puntos de todos
export type PlayerCriterion = (stats: PlayerStats, scores: ScoreMap) => number;

// Un desempate que depende del grupo de empatados; null si no aplica a ese grupo
export type GroupCriterion = (
  group: readonly string[],
  stats: ReadonlyMap<string, PlayerStats>,
) => Map<string, number> | null;
