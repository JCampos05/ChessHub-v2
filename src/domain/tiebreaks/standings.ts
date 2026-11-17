import { computeScores, type PlayedPairing } from '../swiss/scores.js';
import { DEFAULT_TIEBREAK_ORDER, evaluateCriterion, type TiebreakCriterion } from './criteria.js';
import { buildStats } from './stats.js';
import type { PlayerStats } from './types.js';

export interface StandingPlayer {
  id: string;
  folio: number;
}

export interface Standing {
  playerId: string;
  // Los empatados en puntos y desempates comparten posición (1, 2, 2, 4)
  position: number;
  points: number;
  // Valor de cada criterio al momento de aplicarse; el enfrentamiento directo solo aparece si se llegó a evaluar
  tiebreaks: Partial<Record<TiebreakCriterion, number>>;
}

// Agrupa conservando el orden de mayor a menor valor
function splitByValue(group: readonly string[], values: ReadonlyMap<string, number>): string[][] {
  const distinct = [...new Set(group.map((id) => values.get(id) ?? 0))].sort((a, b) => b - a);
  return distinct.map((value) => group.filter((id) => (values.get(id) ?? 0) === value));
}

// Clasificación derivada de los resultados: puntos y, entre empatados, cada desempate en el orden dado
export function rankStandings(
  players: readonly StandingPlayer[],
  history: readonly PlayedPairing[],
  order: readonly TiebreakCriterion[] = DEFAULT_TIEBREAK_ORDER,
): Standing[] {
  const seen = new Set<string>();
  const unique = players.filter((p) => !seen.has(p.id) && seen.add(p.id));
  const folios = new Map(unique.map((p) => [p.id, p.folio]));

  const scores = computeScores(history);
  const stats: Map<string, PlayerStats> = buildStats(history);
  const points = (id: string) => scores.get(id) ?? 0;

  const recorded = new Map<string, Partial<Record<TiebreakCriterion, number>>>();
  const record = (id: string, criterion: TiebreakCriterion, value: number) => {
    recorded.set(id, { ...recorded.get(id), [criterion]: value });
  };

  // Un criterio no vuelve a evaluarse tras haber separado a un grupo: el siguiente solo ve a los que siguen empatados
  const refine = (group: string[], remaining: readonly TiebreakCriterion[]): string[][] => {
    const [criterion, ...rest] = remaining;
    if (group.length <= 1 || criterion === undefined) return [group];

    const values = evaluateCriterion(criterion, group, stats, scores);
    if (values === null) return refine(group, rest);

    for (const id of group) record(id, criterion, values.get(id) ?? 0);
    return splitByValue(group, values).flatMap((bucket) => refine(bucket, rest));
  };

  const ids = unique.map((p) => p.id);
  const classes = splitByValue(ids, new Map(ids.map((id) => [id, points(id)]))).flatMap((group) =>
    refine(group, order),
  );

  const standings: Standing[] = [];
  let position = 1;
  for (const group of classes) {
    const sorted = [...group].sort((a, b) => (folios.get(a) ?? 0) - (folios.get(b) ?? 0) || a.localeCompare(b));
    for (const id of sorted) {
      standings.push({ playerId: id, position, points: points(id), tiebreaks: recorded.get(id) ?? {} });
    }
    position += group.length;
  }
  return standings;
}
