import { describe, expect, it } from 'vitest';
import { NoValidPairingError, pairRound, type PlannedPairing, type SwissPlayer } from '../../src/domain/swiss/pair.js';
import { computeScores, type GameOutcome, type PlayedPairing } from '../../src/domain/swiss/scores.js';
import { buchholz } from '../../src/domain/tiebreaks/buchholz.js';

const played = (
  roundNumber: number,
  whiteId: string,
  blackId: string | null,
  result: GameOutcome = 'PENDING',
): PlayedPairing => ({ roundNumber, whiteId, blackId, result });

const makePlayers = (count: number): SwissPlayer[] =>
  Array.from({ length: count }, (_, i) => ({ id: `p${i + 1}`, rating: 2000 - i * 50, folio: i + 1 }));

describe('puntajes (RF16)', () => {
  it('victoria 1, tablas 0.5, pendiente 0 y descanso 1', () => {
    const scores = computeScores([
      played(1, 'A', 'B', 'WHITE_WINS'),
      played(1, 'C', 'D', 'DRAW'),
      played(1, 'E', null),
      played(2, 'A', 'C', 'PENDING'),
      played(2, 'D', 'B', 'BLACK_WINS'),
    ]);
    expect(scores.get('A')).toBe(1);
    expect(scores.get('B')).toBe(1);
    expect(scores.get('C')).toBe(0.5);
    expect(scores.get('D')).toBe(0.5);
    expect(scores.get('E')).toBe(1);
  });
});

describe('Buchholz básico (RF16)', () => {
  const history = [
    played(1, 'A', 'B', 'WHITE_WINS'),
    played(1, 'C', 'D', 'DRAW'),
    played(1, 'E', null),
    played(2, 'A', 'C', 'WHITE_WINS'),
    played(2, 'B', 'D', 'WHITE_WINS'),
  ];
  const scores = computeScores(history);

  it('suma los puntajes de los rivales enfrentados', () => {
    expect(buchholz('A', history, scores)).toBe(1.5); // B 1 + C 0.5
    expect(buchholz('B', history, scores)).toBe(2.5); // A 2 + D 0.5
    expect(buchholz('C', history, scores)).toBe(2.5); // D 0.5 + A 2
  });

  it('el descanso no suma y quien no jugó rivales vale 0', () => {
    expect(buchholz('E', history, scores)).toBe(0);
    expect(buchholz('Z', history, scores)).toBe(0);
  });
});

describe('pairRound: ronda 1 (RF16)', () => {
  it('empareja la mitad superior contra la inferior, con colores alternos por mesa', () => {
    const round = pairRound({ players: makePlayers(8), history: [] });
    expect(round).toEqual([
      { board: 1, whiteId: 'p1', blackId: 'p5' },
      { board: 2, whiteId: 'p6', blackId: 'p2' },
      { board: 3, whiteId: 'p3', blackId: 'p7' },
      { board: 4, whiteId: 'p8', blackId: 'p4' },
    ]);
  });

  it('con número impar descansa el peor ubicado', () => {
    const round = pairRound({ players: makePlayers(9), history: [] });
    expect(round).toHaveLength(5);
    expect(round[4]).toEqual({ board: 5, whiteId: 'p9', blackId: null });
  });

  it('sin rating, el jugador se ordena al final y el folio desempata', () => {
    const players: SwissPlayer[] = [
      { id: 'sin-rating', rating: null, folio: 1 },
      { id: 'alto', rating: 1800, folio: 2 },
      { id: 'medio', rating: 1500, folio: 3 },
      { id: 'bajo', rating: 1200, folio: 4 },
    ];
    const round = pairRound({ players, history: [] });
    expect(round[0]).toEqual({ board: 1, whiteId: 'alto', blackId: 'bajo' });
    expect(round[1]?.whiteId === 'sin-rating' || round[1]?.blackId === 'sin-rating').toBe(true);
  });

  it('con menos de dos jugadores falla', () => {
    expect(() => pairRound({ players: makePlayers(1), history: [] })).toThrow(NoValidPairingError);
  });
});

describe('pairRound: rondas siguientes (RF16)', () => {
  it('empareja por grupos de puntaje', () => {
    const players = makePlayers(4);
    const history = [played(1, 'p1', 'p3', 'WHITE_WINS'), played(1, 'p4', 'p2', 'BLACK_WINS')];
    const round = pairRound({ players, history });
    const pairOf = (id: string) => round.find((p) => p.whiteId === id || p.blackId === id)!;
    // p1 y p2 ganaron; p3 y p4 perdieron
    expect([pairOf('p1').whiteId, pairOf('p1').blackId].sort()).toEqual(['p1', 'p2']);
    expect([pairOf('p3').whiteId, pairOf('p3').blackId].sort()).toEqual(['p3', 'p4']);
  });

  it('nunca repite pareja aunque el orden lo sugiera', () => {
    const players = makePlayers(4);
    const history = [played(1, 'p1', 'p3', 'DRAW'), played(1, 'p2', 'p4', 'DRAW')];
    const round = pairRound({ players, history });
    const keys = round.map((p) => [p.whiteId, p.blackId].sort().join('|'));
    expect(keys).not.toContain('p1|p3');
    expect(keys).not.toContain('p2|p4');
  });

  it('el descanso no recae en quien ya descansó', () => {
    const players = makePlayers(3);
    const history = [played(1, 'p3', null), played(1, 'p1', 'p2', 'WHITE_WINS')];
    const round = pairRound({ players, history });
    const bye = round.find((p) => p.blackId === null)!;
    expect(bye.whiteId).not.toBe('p3');
  });

  it('falla si todos ya se enfrentaron entre sí', () => {
    const players = makePlayers(2);
    expect(() => pairRound({ players, history: [played(1, 'p1', 'p2', 'DRAW')] })).toThrow(NoValidPairingError);
  });
});

// Torneo simulado con resultados repetibles (generador congruencial)
function simulate(count: number, rounds: number, seed: number) {
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state;
  };
  const players = makePlayers(count);
  const history: PlayedPairing[] = [];
  const perRound: PlannedPairing[][] = [];

  for (let round = 1; round <= rounds; round += 1) {
    const pairings = pairRound({ players, history });
    perRound.push(pairings);
    for (const p of pairings) {
      const outcomes: GameOutcome[] = ['WHITE_WINS', 'BLACK_WINS', 'DRAW'];
      history.push(played(round, p.whiteId, p.blackId, outcomes[next() % 3]!));
    }
  }
  return { perRound, history };
}

describe.each([8, 9, 20])('propiedades con %i jugadores a 5 rondas (RF16, RN-04)', (count) => {
  const { perRound } = simulate(count, 5, 7);

  it('cada jugador aparece exactamente una vez por ronda', () => {
    for (const round of perRound) {
      const ids = round.flatMap((p) => (p.blackId === null ? [p.whiteId] : [p.whiteId, p.blackId]));
      expect(ids).toHaveLength(count);
      expect(new Set(ids).size).toBe(count);
    }
  });

  it('nadie se enfrenta a sí mismo ni repite rival', () => {
    const seen = new Set<string>();
    for (const round of perRound) {
      for (const p of round) {
        if (p.blackId === null) continue;
        expect(p.whiteId).not.toBe(p.blackId);
        const key = [p.whiteId, p.blackId].sort().join('|');
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it('a lo sumo un descanso por jugador y uno por ronda cuando el número es impar', () => {
    const byes = perRound.flat().filter((p) => p.blackId === null).map((p) => p.whiteId);
    expect(new Set(byes).size).toBe(byes.length);
    expect(byes).toHaveLength(count % 2 === 1 ? 5 : 0);
  });

  it('los colores quedan equilibrados: diferencia máxima 2 y nunca tres iguales seguidas', () => {
    const colors = new Map<string, string[]>();
    for (const round of perRound) {
      for (const p of round) {
        if (p.blackId === null) continue;
        colors.set(p.whiteId, [...(colors.get(p.whiteId) ?? []), 'W']);
        colors.set(p.blackId, [...(colors.get(p.blackId) ?? []), 'B']);
      }
    }
    for (const sequence of colors.values()) {
      const whites = sequence.filter((c) => c === 'W').length;
      expect(Math.abs(whites - (sequence.length - whites))).toBeLessThanOrEqual(2);
      expect(sequence.join('')).not.toMatch(/WWW|BBB/);
    }
  });

  it('numera las mesas de 1 a n en secuencia', () => {
    for (const round of perRound) expect(round.map((p) => p.board)).toEqual(round.map((_, i) => i + 1));
  });

  it('es determinista: el mismo insumo da el mismo resultado', () => {
    expect(simulate(count, 5, 7).perRound).toEqual(perRound);
  });
});

// Historial armado a mano: `id` juega contra rivales que ya no están, con los resultados indicados
// (W gana, D tablas, L pierde) y colores alternos empezando con blancas. Todo en la ronda 1 para que ninguno
// cuente como flotador de la ronda anterior
type Outcome = 'W' | 'D' | 'L';
function games(id: string, outcomes: Outcome[]): PlayedPairing[] {
  return outcomes.map((outcome, i) => {
    const asWhite = i % 2 === 0;
    const ghost = `${id}-rival-${i}`;
    const result: GameOutcome = outcome === 'D' ? 'DRAW' : (outcome === 'W') === asWhite ? 'WHITE_WINS' : 'BLACK_WINS';
    return played(1, asWhite ? id : ghost, asWhite ? ghost : id, result);
  });
}

const named = (ids: string[]): SwissPlayer[] =>
  ids.map((id, i) => ({ id, rating: 2000 - i * 50, folio: i + 1 }));

const opponentOf = (round: PlannedPairing[], id: string): string | null | undefined => {
  const pairing = round.find((p) => p.whiteId === id || p.blackId === id);
  if (!pairing) return undefined;
  return pairing.whiteId === id ? pairing.blackId : pairing.whiteId;
};

const reasonOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return (error as NoValidPairingError).reason;
  }
  return undefined;
};

describe('flotadores (RF16)', () => {
  it('el jugador que queda solo en su grupo de 2 puntos baja al grupo de 1.5 si existe', () => {
    const history = [
      ...games('A', ['W', 'W']),
      ...games('B', ['W', 'W']),
      ...games('C', ['W', 'W']),
      ...games('D', ['W', 'D']),
      ...games('E', ['W', 'L']),
      ...games('F', ['L', 'L']),
    ];
    const round = pairRound({ players: named(['A', 'B', 'C', 'D', 'E', 'F']), history });

    expect(opponentOf(round, 'A')).toBe('B');
    expect(opponentOf(round, 'C')).toBe('D'); // el flotador juega contra el de 1.5
    expect(opponentOf(round, 'E')).toBe('F');
  });

  it('si no hay grupo de 1.5, el flotador baja al de 1 punto', () => {
    const history = [
      ...games('A', ['W', 'W']),
      ...games('B', ['W', 'W']),
      ...games('C', ['W', 'W']),
      ...games('D', ['W', 'L']),
      ...games('E', ['W', 'L']),
      ...games('F', ['W', 'L']),
    ];
    const round = pairRound({ players: named(['A', 'B', 'C', 'D', 'E', 'F']), history });

    expect(opponentOf(round, 'A')).toBe('B');
    expect(opponentOf(round, 'C')).toBe('D');
    expect(opponentOf(round, 'E')).toBe('F');
  });

  it('quien descansó en la ronda anterior no baja otra vez si hay alternativa', () => {
    const players = makePlayers(9);
    const first = pairRound({ players, history: [] });
    const history: PlayedPairing[] = first.map((p) => {
      if (p.blackId === null) return played(1, p.whiteId, null);
      const whiteIsHigher = Number(p.whiteId.slice(1)) < Number(p.blackId.slice(1));
      return played(1, p.whiteId, p.blackId, whiteIsHigher ? 'WHITE_WINS' : 'BLACK_WINS');
    });
    // Ronda 1: ganan p1 a p4 y descansa p9 (5 jugadores con 1 punto); p5 a p8 tienen 0
    const bye = first.find((p) => p.blackId === null)!;
    expect(bye.whiteId).toBe('p9');

    const second = pairRound({ players, history });
    const scores = computeScores(history);
    const cross = second.filter(
      (p) => p.blackId !== null && scores.get(p.whiteId) !== scores.get(p.blackId),
    );

    // Un solo flote entre los grupos de 1 y 0 puntos, y no lo hace p9, que ya bajó con el descanso
    expect(cross).toHaveLength(1);
    const floater = [cross[0]!.whiteId, cross[0]!.blackId!].find((id) => scores.get(id) === 1)!;
    expect(floater).not.toBe('p9');
    expect(second.find((p) => p.blackId === null)!.whiteId).toBe('p8');
  });
});

describe('descanso (bye) (RN-04)', () => {
  it('nunca se asigna un segundo descanso: si todos ya descansaron, falla', () => {
    const history = [
      played(1, 'p3', null),
      played(1, 'p1', 'p2', 'WHITE_WINS'),
      played(2, 'p2', null),
      played(2, 'p1', 'p3', 'WHITE_WINS'),
      played(3, 'p1', null),
      played(3, 'p2', 'p3', 'WHITE_WINS'),
    ];
    expect(reasonOf(() => pairRound({ players: makePlayers(3), history }))).toBe('BYE_EXHAUSTED');
  });

  it('si descansar al peor ubicado deja un emparejamiento imposible, descansa el siguiente', () => {
    // p1, p2 y p3 ya jugaron entre sí; p4 ya descansó. El peor ubicado, p5, dejaría a los tres con un solo
    // rival posible (p4), así que el descanso pasa a p3 y p1-p4 y p2-p5 (o a la inversa) sí son válidos
    const history = [
      played(1, 'p1', 'p2', 'DRAW'),
      played(2, 'p1', 'p3', 'DRAW'),
      played(3, 'p2', 'p3', 'DRAW'),
      played(1, 'p4', null),
    ];
    const round = pairRound({ players: makePlayers(5), history });
    const ids = round.flatMap((p) => (p.blackId === null ? [p.whiteId] : [p.whiteId, p.blackId]));
    expect(new Set(ids).size).toBe(5);
    expect(round.find((p) => p.blackId === null)!.whiteId).toBe('p3');
  });
});

// Partidas de `id` contra rivales que ya no están, todas en tablas, con los colores indicados ronda a ronda
function drawsWithColors(id: string, colors: ('W' | 'B')[]): PlayedPairing[] {
  return colors.map((color, i) => {
    const ghost = `${id}-rival-${i}`;
    return color === 'W' ? played(i + 1, id, ghost, 'DRAW') : played(i + 1, ghost, id, 'DRAW');
  });
}

describe('balance de color de -2 a +2 (RF16)', () => {
  // Balance = blancas - negras. En +2 solo puede recibir negras; en -2, solo blancas; en 0 es neutral
  it.each([
    { name: '+2 recibe negras', seq: ['W', 'W', 'B', 'W'] as ('W' | 'B')[], expectBlack: true },
    { name: '-2 recibe blancas', seq: ['B', 'B', 'W', 'B'] as ('W' | 'B')[], expectBlack: false },
  ])('con balance $name aunque el rival esté neutral', ({ seq, expectBlack }) => {
    const history = [...drawsWithColors('X', seq), ...drawsWithColors('Y', ['W', 'B', 'W', 'B'])];
    const [pairing] = pairRound({ players: named(['X', 'Y']), history });

    if (expectBlack) expect(pairing).toMatchObject({ whiteId: 'Y', blackId: 'X' });
    else expect(pairing).toMatchObject({ whiteId: 'X', blackId: 'Y' });
  });

  it('el balance neutral (0) no obliga: se decide por quién jugó negras al final', () => {
    // X: W,B (balance 0, última negras); Y: B,W (balance 0, última blancas) → X lleva blancas
    const history = [...drawsWithColors('X', ['W', 'B']), ...drawsWithColors('Y', ['B', 'W'])];
    const [pairing] = pairRound({ players: named(['X', 'Y']), history });
    expect(pairing).toMatchObject({ whiteId: 'X', blackId: 'Y' });
  });

  it('un descanso no mueve el balance de color', () => {
    // X lleva +2 con un bye en medio; el bye no cuenta ni como blancas ni como negras
    const history = [
      played(1, 'X', 'g1', 'DRAW'),
      played(2, 'X', 'g2', 'DRAW'),
      played(3, 'X', null),
      played(4, 'Z', 'g3', 'DRAW'),
    ];
    const [pairing] = pairRound({ players: named(['X', 'Z']), history });
    // X: 2 blancas y 0 negras (+2): no puede volver a tener blancas
    expect(pairing).toMatchObject({ whiteId: 'Z', blackId: 'X' });
  });
});

describe('colores imposibles y límites (RF16)', () => {
  it('si los dos llevan dos blancas seguidas empareja igual, con una sola violación', () => {
    const history = [
      played(1, 'X', 'g1', 'WHITE_WINS'),
      played(2, 'X', 'g2', 'WHITE_WINS'),
      played(1, 'Y', 'h1', 'WHITE_WINS'),
      played(2, 'Y', 'h2', 'WHITE_WINS'),
    ];
    const round = pairRound({ players: named(['X', 'Y']), history });
    expect(round).toHaveLength(1);
    expect([round[0]!.whiteId, round[0]!.blackId].sort()).toEqual(['X', 'Y']);
  });

  it('al agotarse las rondas posibles falla con NO_SOLUTION', () => {
    // Con 4 jugadores, tres rondas agotan todas las parejas
    const { history } = simulate(4, 3, 1);
    expect(reasonOf(() => pairRound({ players: makePlayers(4), history }))).toBe('NO_SOLUTION');
  });

  it('un jugador repetido en la entrada se toma una sola vez', () => {
    const players = [...makePlayers(4), makePlayers(4)[0]!];
    expect(pairRound({ players, history: [] })).toHaveLength(2);
  });
});

describe('ingresos tardíos y retiros (RF16)', () => {
  it('quien entra después de la ronda 1 parte de 0 puntos y se empareja sin errores', () => {
    const history = [played(1, 'p1', 'p3', 'WHITE_WINS'), played(1, 'p2', 'p4', 'WHITE_WINS')];
    const round = pairRound({ players: makePlayers(5), history });
    const ids = round.flatMap((p) => (p.blackId === null ? [p.whiteId] : [p.whiteId, p.blackId]));

    expect(new Set(ids)).toEqual(new Set(['p1', 'p2', 'p3', 'p4', 'p5']));
    expect(round).toHaveLength(3);
  });

  it('los retirados no aparecen, pero sus partidas siguen contando para el puntaje de sus rivales', () => {
    const history = [
      played(1, 'p1', 'retirado', 'WHITE_WINS'),
      played(1, 'p2', 'p3', 'DRAW'),
      played(1, 'p4', 'otro-retirado', 'BLACK_WINS'),
    ];
    const round = pairRound({ players: makePlayers(4), history });
    const ids = round.flatMap((p) => (p.blackId === null ? [p.whiteId] : [p.whiteId, p.blackId]));

    expect(ids.sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
    // p1 (1 punto) se enfrenta a p2 o p3 (0.5) antes que a p4 (0)
    expect(['p2', 'p3']).toContain(opponentOf(round, 'p1'));
  });
});

describe.each([8, 9, 20])('muchas semillas con %i jugadores (RF16, RN-04)', (count) => {
  const rounds = count === 8 ? 4 : 5;

  it('siempre emparejan a todos una vez, sin repetir rival ni descanso', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const { perRound } = simulate(count, rounds, seed);
      const pairs = new Set<string>();
      const byes = new Set<string>();

      for (const round of perRound) {
        const ids = round.flatMap((p) => (p.blackId === null ? [p.whiteId] : [p.whiteId, p.blackId]));
        expect(new Set(ids).size).toBe(count);
        for (const p of round) {
          if (p.blackId === null) {
            expect(byes.has(p.whiteId)).toBe(false);
            byes.add(p.whiteId);
          } else {
            const key = [p.whiteId, p.blackId].sort().join('|');
            expect(pairs.has(key)).toBe(false);
            pairs.add(key);
          }
        }
      }
    }
  });
});

describe('torneo grande (RNF02)', () => {
  it('60 jugadores a 6 rondas se emparejan en un tiempo razonable y sin repetir rivales', () => {
    const started = Date.now();
    const { perRound } = simulate(60, 6, 3);
    const elapsed = Date.now() - started;

    const pairs = new Set<string>();
    for (const round of perRound) {
      for (const p of round) {
        const key = [p.whiteId, p.blackId].sort().join('|');
        expect(pairs.has(key)).toBe(false);
        pairs.add(key);
      }
    }
    expect(elapsed).toBeLessThan(5000);
  });
});
