import { buildStats } from '../tiebreaks/stats.js';
import { buchholzCriterion } from '../tiebreaks/type-tiebreaks.js';
import { emptyStats } from '../tiebreaks/types.js';
import { computeScores, type PlayedPairing } from './scores.js';

export interface SwissPlayer {
  id: string;
  rating: number | null;
  folio: number;
}

export interface PairRoundInput {
  players: readonly SwissPlayer[];
  history: readonly PlayedPairing[];
}

export interface PlannedPairing {
  board: number;
  whiteId: string;
  // null = descanso (bye)
  blackId: string | null;
}

export type NoValidPairingReason = 'NOT_ENOUGH_PLAYERS' | 'NO_SOLUTION' | 'BYE_EXHAUSTED' | 'SEARCH_LIMIT';

const MESSAGES: Record<NoValidPairingReason, string> = {
  NOT_ENOUGH_PLAYERS: 'Se necesitan al menos 2 jugadores para emparejar',
  NO_SOLUTION: 'No existe un emparejamiento válido que evite repetir rivales',
  BYE_EXHAUSTED: 'Todos los jugadores ya descansaron una vez y no hay a quién asignar el descanso',
  SEARCH_LIMIT: 'No se encontró un emparejamiento dentro del límite de búsqueda',
};

export class NoValidPairingError extends Error {
  constructor(public readonly reason: NoValidPairingReason = 'NO_SOLUTION') {
    super(MESSAGES[reason]);
    this.name = 'NoValidPairingError';
  }
}

type Color = 'W' | 'B';
type Float = 'DOWN' | 'UP';

interface Entry {
  player: SwissPlayer;
  score: number;
  tiebreak: number;
  whites: number;
  blacks: number;
  last: Color[];
  hadBye: boolean;
  // Cómo jugó la ronda anterior: bajó (DOWN) a un grupo de menor puntaje o subió (UP) a uno de mayor.
  // El descanso cuenta como bajada. Sirve para evitar que alguien flote dos rondas seguidas en el mismo sentido
  lastFloat: Float | null;
  opponents: Set<string>;
}

interface Pair {
  white: Entry;
  black: Entry;
}

// Cuántas concesiones se admiten en un intento: violaciones de color y flotes repetidos
interface Limits {
  color: number;
  float: number;
}

interface Budget {
  // Nodos que quedan en toda la generación y en el intento actual
  total: number;
  attempt: number;
}

interface Used {
  color: number;
  float: number;
}

// De lo más estricto a lo más permisivo. El color se cuida antes que los flotes; nunca se repite pareja
const LADDER: readonly Limits[] = [
  { color: 0, float: 0 },
  { color: 0, float: 2 },
  { color: 0, float: Number.POSITIVE_INFINITY },
  { color: 1, float: Number.POSITIVE_INFINITY },
  { color: 2, float: Number.POSITIVE_INFINITY },
  { color: 4, float: Number.POSITIVE_INFINITY },
  { color: Number.POSITIVE_INFINITY, float: Number.POSITIVE_INFINITY },
];

// Tope de nodos de toda la generación y de cada intento; evita tiempos explosivos con el torneo bloqueado
const TOTAL_BUDGET = 300_000;
const ATTEMPT_BUDGET = 30_000;

// Quién bajó o subió en la ronda más reciente del historial, según el puntaje que tenían antes de jugarla
function lastFloats(history: readonly PlayedPairing[]): Map<string, Float> {
  const floats = new Map<string, Float>();
  if (history.length === 0) return floats;

  const lastRound = history.reduce((max, p) => Math.max(max, p.roundNumber), 0);
  const before = computeScores(history.filter((p) => p.roundNumber < lastRound));

  for (const pairing of history) {
    if (pairing.roundNumber !== lastRound) continue;
    if (pairing.blackId === null) {
      floats.set(pairing.whiteId, 'DOWN');
      continue;
    }
    const white = before.get(pairing.whiteId) ?? 0;
    const black = before.get(pairing.blackId) ?? 0;
    if (white > black) {
      floats.set(pairing.whiteId, 'DOWN');
      floats.set(pairing.blackId, 'UP');
    } else if (black > white) {
      floats.set(pairing.blackId, 'DOWN');
      floats.set(pairing.whiteId, 'UP');
    }
  }
  return floats;
}

function buildEntries(input: PairRoundInput): Entry[] {
  const scores = computeScores(input.history);
  const stats = buildStats(input.history);
  const floats = lastFloats(input.history);
  const ordered = [...input.history].sort((a, b) => a.roundNumber - b.roundNumber);

  // Un jugador repetido en la entrada se toma una sola vez
  const seen = new Set<string>();
  const players = input.players.filter((p) => !seen.has(p.id) && seen.add(p.id));

  return players.map((player) => {
    const entry: Entry = {
      player,
      score: scores.get(player.id) ?? 0,
      tiebreak: buchholzCriterion(stats.get(player.id) ?? emptyStats(), scores),
      whites: 0,
      blacks: 0,
      last: [],
      hadBye: false,
      lastFloat: floats.get(player.id) ?? null,
      opponents: new Set(),
    };
    for (const pairing of ordered) {
      if (pairing.whiteId === player.id) {
        if (pairing.blackId === null) {
          entry.hadBye = true;
        } else {
          entry.whites += 1;
          entry.last.push('W');
          entry.opponents.add(pairing.blackId);
        }
      } else if (pairing.blackId === player.id) {
        entry.blacks += 1;
        entry.last.push('B');
        entry.opponents.add(pairing.whiteId);
      }
    }
    return entry;
  });
}

// Puntaje, Buchholz, rating (sin rating al final) y folio: el orden es total, sin empates
function compareRank(a: Entry, b: Entry): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.tiebreak !== b.tiebreak) return b.tiebreak - a.tiebreak;
  const ra = a.player.rating ?? Number.NEGATIVE_INFINITY;
  const rb = b.player.rating ?? Number.NEGATIVE_INFINITY;
  if (ra !== rb) return rb - ra;
  return a.player.folio - b.player.folio;
}

// Diferencia máxima de 2 entre blancas y negras y nunca tres veces el mismo color seguidas
function canTake(entry: Entry, color: Color): boolean {
  const whites = entry.whites + (color === 'W' ? 1 : 0);
  const blacks = entry.blacks + (color === 'B' ? 1 : 0);
  if (Math.abs(whites - blacks) > 2) return false;
  const [prev, latest] = [entry.last[entry.last.length - 2], entry.last[entry.last.length - 1]];
  return !(prev === color && latest === color);
}

// Quién lleva blancas cuando ambas opciones cuestan lo mismo: a quien le toca por equilibrio; luego a quien jugó
// negras al final; en el último empate se alterna por mesa
function prefersWhite(a: Entry, b: Entry, index: number): boolean {
  const due = (e: Entry) => e.blacks - e.whites;
  if (due(a) !== due(b)) return due(a) > due(b);
  const la = a.last[a.last.length - 1];
  const lb = b.last[b.last.length - 1];
  if (la !== lb) return la === 'B' || lb === 'W';
  return index % 2 === 0;
}

// Elige los colores de la pareja con el menor número de violaciones (0, 1 o 2)
function chooseColors(a: Entry, b: Entry, index: number): Pair & { cost: number } {
  const costAWhite = (canTake(a, 'W') ? 0 : 1) + (canTake(b, 'B') ? 0 : 1);
  const costBWhite = (canTake(b, 'W') ? 0 : 1) + (canTake(a, 'B') ? 0 : 1);
  const aWhite = costAWhite !== costBWhite ? costAWhite < costBWhite : prefersWhite(a, b, index);
  return aWhite
    ? { white: a, black: b, cost: costAWhite }
    : { white: b, black: a, cost: costBWhite };
}

// Flote repetido: el de mayor puntaje baja otra vez, o el de menor puntaje sube otra vez.
// `high` va siempre antes que `low` en el orden, así que tiene puntaje igual o mayor
function floatCost(high: Entry, low: Entry): number {
  if (high.score === low.score) return 0;
  return (high.lastFloat === 'DOWN' ? 1 : 0) + (low.lastFloat === 'UP' ? 1 : 0);
}

// Búsqueda con retroceso. El primer jugador libre toma al rival mejor ubicado que no repita pareja.
// Dentro de su grupo de puntaje el rival ideal es el de la mitad inferior en la misma posición (ronda 1: 1 contra
// n/2+1). Si el grupo es impar, el jugador que queda solo es el flotador: baja al grupo de puntaje más cercano
// (por ejemplo de 2 puntos a 1.5, y si no hay, a 1) y se empareja con el mejor ubicado de ese grupo
function search(list: Entry[], limits: Limits, budget: Budget, pairs: Pair[], used: Used): boolean {
  const head = list[0];
  if (head === undefined) return true;
  if (budget.total <= 0 || budget.attempt <= 0) return false;
  budget.total -= 1;
  budget.attempt -= 1;

  const rest = list.slice(1);
  const group = [head, ...rest.filter((e) => e.score === head.score)];
  const half = Math.floor(group.length / 2);

  const candidates = rest
    .map((entry, restIndex) => ({
      entry,
      restIndex,
      scoreGap: head.score - entry.score,
      distance: entry.score === head.score ? Math.abs(group.indexOf(entry) - half) : 0,
    }))
    .sort((x, y) => x.scoreGap - y.scoreGap || x.distance - y.distance || x.restIndex - y.restIndex);

  for (const { entry } of candidates) {
    if (head.opponents.has(entry.player.id)) continue;

    const chosen = chooseColors(head, entry, pairs.length);
    const floats = floatCost(head, entry);
    if (used.color + chosen.cost > limits.color || used.float + floats > limits.float) continue;

    pairs.push({ white: chosen.white, black: chosen.black });
    used.color += chosen.cost;
    used.float += floats;
    if (search(rest.filter((e) => e !== entry), limits, budget, pairs, used)) return true;
    used.color -= chosen.cost;
    used.float -= floats;
    pairs.pop();
  }
  return false;
}

// Genera los emparejamientos de la siguiente ronda. Pura y determinista: mismo insumo, mismo resultado.
// Los jugadores que ya no están (retirados, cancelados) simplemente no se incluyen en `players`: sus partidas
// siguen en `history` y cuentan para los puntajes de sus rivales. Quien entra tarde no tiene partidas previas
// y parte de 0 puntos
export function pairRound(input: PairRoundInput): PlannedPairing[] {
  const ranked = buildEntries(input).sort(compareRank);
  if (ranked.length < 2) throw new NoValidPairingError('NOT_ENOUGH_PLAYERS');

  // Con número impar, uno descansa: el de peor ubicación que aún no haya descansado. Nunca dos descansos al mismo
  const byeCandidates: (Entry | null)[] =
    ranked.length % 2 === 0 ? [null] : [...ranked].reverse().filter((e) => !e.hadBye);
  if (byeCandidates.length === 0) throw new NoValidPairingError('BYE_EXHAUSTED');

  const budget: Budget = { total: TOTAL_BUDGET, attempt: 0 };
  for (const limits of LADDER) {
    for (const bye of byeCandidates) {
      if (budget.total <= 0) throw new NoValidPairingError('SEARCH_LIMIT');
      budget.attempt = ATTEMPT_BUDGET;

      const pairs: Pair[] = [];
      if (!search(ranked.filter((e) => e !== bye), limits, budget, pairs, { color: 0, float: 0 })) continue;

      const planned: PlannedPairing[] = pairs.map((pair, index) => ({
        board: index + 1,
        whiteId: pair.white.player.id,
        blackId: pair.black.player.id,
      }));
      if (bye) planned.push({ board: planned.length + 1, whiteId: bye.player.id, blackId: null });
      return planned;
    }
  }
  throw new NoValidPairingError(budget.total <= 0 ? 'SEARCH_LIMIT' : 'NO_SOLUTION');
}
