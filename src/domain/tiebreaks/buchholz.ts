import type { PlayedPairing } from '../swiss/scores.js';

// Buchholz básico: suma de los puntajes de los rivales enfrentados. El descanso (bye) no suma.
export function buchholz(
  playerId: string,
  history: readonly PlayedPairing[],
  scores: ReadonlyMap<string, number>,
): number {
  let total = 0;
  for (const pairing of history) {
    if (pairing.blackId === null) continue;
    if (pairing.whiteId === playerId) total += scores.get(pairing.blackId) ?? 0;
    else if (pairing.blackId === playerId) total += scores.get(pairing.whiteId) ?? 0;
  }
  return total;
}
