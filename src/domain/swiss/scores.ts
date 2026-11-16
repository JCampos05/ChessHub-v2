// Puntajes de un torneo suizo a partir de los emparejamientos jugados

export type GameOutcome = 'WHITE_WINS' | 'BLACK_WINS' | 'DRAW' | 'PENDING';

export interface PlayedPairing {
  roundNumber: number;
  whiteId: string;
  // null = descanso (bye): el jugador de blancas recibe el punto completo
  blackId: string | null;
  result: GameOutcome;
}

// Victoria 1, tablas 0.5, descanso 1, resultado pendiente 0
export function computeScores(history: readonly PlayedPairing[]): Map<string, number> {
  const scores = new Map<string, number>();
  const add = (id: string, points: number) => scores.set(id, (scores.get(id) ?? 0) + points);

  for (const pairing of history) {
    add(pairing.whiteId, 0);
    if (pairing.blackId === null) {
      add(pairing.whiteId, 1);
      continue;
    }
    add(pairing.blackId, 0);
    if (pairing.result === 'WHITE_WINS') add(pairing.whiteId, 1);
    else if (pairing.result === 'BLACK_WINS') add(pairing.blackId, 1);
    else if (pairing.result === 'DRAW') {
      add(pairing.whiteId, 0.5);
      add(pairing.blackId, 0.5);
    }
  }
  return scores;
}
