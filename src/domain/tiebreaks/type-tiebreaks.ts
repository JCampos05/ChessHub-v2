import type { GroupCriterion, PlayerCriterion, PlayerStats, ScoreMap } from './types.js';

// Puntos de cada rival enfrentado (una entrada por partida jugada)
const opponentScores = (stats: PlayerStats, scores: ScoreMap): number[] =>
  stats.games.map((game) => scores.get(game.opponentId) ?? 0);

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

// Buchholz: suma de los puntos de todos los rivales enfrentados
export const buchholzCriterion: PlayerCriterion = (stats, scores) => sum(opponentScores(stats, scores));

// Buchholz corte 1: Buchholz sin el rival de menor puntaje
export const buchholzCut1Criterion: PlayerCriterion = (stats, scores) => {
  const values = opponentScores(stats, scores);
  return values.length === 0 ? 0 : sum(values) - Math.min(...values);
};

// Buchholz mediano 1: Buchholz sin el rival de mayor y el de menor puntaje; con dos rivales o menos vale 0
export const buchholzMedian1Criterion: PlayerCriterion = (stats, scores) => {
  const values = opponentScores(stats, scores);
  return values.length <= 2 ? 0 : sum(values) - Math.min(...values) - Math.max(...values);
};

// Sonneborn-Berger: suma de (puntos obtenidos contra el rival × puntos totales del rival)
export const sonnebornBergerCriterion: PlayerCriterion = (stats, scores) =>
  sum(stats.games.map((game) => game.points * (scores.get(game.opponentId) ?? 0)));

// Victorias: partidas jugadas y ganadas (el descanso no cuenta)
export const winsCriterion: PlayerCriterion = (stats) => stats.games.filter((game) => game.points === 1).length;

// Victorias con negras
export const blackWinsCriterion: PlayerCriterion = (stats) =>
  stats.games.filter((game) => game.points === 1 && game.color === 'B').length;

// Puntaje progresivo: suma de los puntos acumulados al final de cada ronda
export const progressiveCriterion: PlayerCriterion = (stats) => stats.progressive;

// Enfrentamiento directo: puntos obtenidos contra los demás miembros del grupo.
// Devuelve null (no aplica) si no todos jugaron entre sí.
export const directEncounterCriterion: GroupCriterion = (group, stats) => {
  const members = new Set(group);
  const values = new Map<string, number>();

  for (const id of group) {
    const faced = new Set<string>();
    let points = 0;
    for (const game of stats.get(id)?.games ?? []) {
      if (!members.has(game.opponentId) || game.opponentId === id) continue;
      faced.add(game.opponentId);
      points += game.points;
    }
    if (faced.size !== group.length - 1) return null;
    values.set(id, points);
  }
  return values;
};
