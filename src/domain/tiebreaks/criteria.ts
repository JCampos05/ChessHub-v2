import {
  blackWinsCriterion,
  buchholzCriterion,
  buchholzCut1Criterion,
  buchholzMedian1Criterion,
  directEncounterCriterion,
  progressiveCriterion,
  sonnebornBergerCriterion,
  winsCriterion,
} from './type-tiebreaks.js';
import { emptyStats, type PlayerCriterion, type PlayerStats, type ScoreMap } from './types.js';

export { buildStats } from './stats.js';
export type { PlayedGame, PlayerStats } from './types.js';

export const TIEBREAK_CRITERIA = [
  'BUCHHOLZ',
  'BUCHHOLZ_CUT1',
  'BUCHHOLZ_MEDIAN1',
  'SONNEBORN_BERGER',
  'WINS',
  'BLACK_WINS',
  'DIRECT_ENCOUNTER',
  'PROGRESSIVE',
] as const;

export type TiebreakCriterion = (typeof TIEBREAK_CRITERIA)[number];
export type PlayerTiebreakCriterion = Exclude<TiebreakCriterion, 'DIRECT_ENCOUNTER'>;

// Orden por omisión de la clasificación
export const DEFAULT_TIEBREAK_ORDER: readonly TiebreakCriterion[] = [
  'BUCHHOLZ',
  'BUCHHOLZ_CUT1',
  'SONNEBORN_BERGER',
  'WINS',
  'DIRECT_ENCOUNTER',
];

// Una función por desempate. Agregar uno exige su entrada aquí: el compilador avisa si falta
export const PLAYER_CRITERIA: Record<PlayerTiebreakCriterion, PlayerCriterion> = {
  BUCHHOLZ: buchholzCriterion,
  BUCHHOLZ_CUT1: buchholzCut1Criterion,
  BUCHHOLZ_MEDIAN1: buchholzMedian1Criterion,
  SONNEBORN_BERGER: sonnebornBergerCriterion,
  WINS: winsCriterion,
  BLACK_WINS: blackWinsCriterion,
  PROGRESSIVE: progressiveCriterion,
};

// Valor de un criterio por jugador para un grupo de empatados; null si el criterio no aplica a ese grupo
export function evaluateCriterion(
  criterion: TiebreakCriterion,
  group: readonly string[],
  stats: ReadonlyMap<string, PlayerStats>,
  scores: ScoreMap,
): Map<string, number> | null {
  if (criterion === 'DIRECT_ENCOUNTER') return directEncounterCriterion(group, stats);
  const calculate = PLAYER_CRITERIA[criterion];
  return new Map(group.map((id) => [id, calculate(stats.get(id) ?? emptyStats(), scores)]));
}

// Valor de un criterio individual para un jugador (sin historial vale 0)
export function criterionValue(
  criterion: PlayerTiebreakCriterion,
  stats: PlayerStats | undefined,
  scores: ScoreMap,
): number {
  return PLAYER_CRITERIA[criterion](stats ?? emptyStats(), scores);
}
