import type { PlayedPairing } from '../swiss/scores.js';
import { emptyStats, type PlayerStats } from './types.js';

// Puntos que obtuvo cada jugador en cada ronda (el descanso vale 1, lo pendiente 0)
function pointsByRound(history: readonly PlayedPairing[]): Map<string, Map<number, number>> {
  const result = new Map<string, Map<number, number>>();
  const add = (id: string, round: number, points: number) => {
    const rounds = result.get(id) ?? new Map<number, number>();
    rounds.set(round, (rounds.get(round) ?? 0) + points);
    result.set(id, rounds);
  };

  for (const pairing of history) {
    if (pairing.blackId === null) {
      add(pairing.whiteId, pairing.roundNumber, 1);
      continue;
    }
    add(pairing.whiteId, pairing.roundNumber, 0);
    add(pairing.blackId, pairing.roundNumber, 0);
    if (pairing.result === 'WHITE_WINS') add(pairing.whiteId, pairing.roundNumber, 1);
    else if (pairing.result === 'BLACK_WINS') add(pairing.blackId, pairing.roundNumber, 1);
    else if (pairing.result === 'DRAW') {
      add(pairing.whiteId, pairing.roundNumber, 0.5);
      add(pairing.blackId, pairing.roundNumber, 0.5);
    }
  }
  return result;
}

// Partidas jugadas y puntaje progresivo de cada jugador. Las mesas sin resultado y los descansos no aportan rival
export function buildStats(history: readonly PlayedPairing[]): Map<string, PlayerStats> {
  const stats = new Map<string, PlayerStats>();
  const of = (id: string): PlayerStats => {
    const existing = stats.get(id);
    if (existing) return existing;
    const created = emptyStats();
    stats.set(id, created);
    return created;
  };

  for (const pairing of history) {
    of(pairing.whiteId);
    if (pairing.blackId === null) continue;
    of(pairing.blackId);
    if (pairing.result === 'PENDING') continue;

    const whitePoints = pairing.result === 'WHITE_WINS' ? 1 : pairing.result === 'DRAW' ? 0.5 : 0;
    const blackPoints = pairing.result === 'BLACK_WINS' ? 1 : pairing.result === 'DRAW' ? 0.5 : 0;
    of(pairing.whiteId).games.push({ opponentId: pairing.blackId, points: whitePoints, color: 'W' });
    of(pairing.blackId).games.push({ opponentId: pairing.whiteId, points: blackPoints, color: 'B' });
  }

  const lastRound = history.reduce((max, p) => Math.max(max, p.roundNumber), 0);
  for (const [id, rounds] of pointsByRound(history)) {
    let running = 0;
    let total = 0;
    for (let round = 1; round <= lastRound; round += 1) {
      running += rounds.get(round) ?? 0;
      total += running;
    }
    of(id).progressive = total;
  }
  return stats;
}
