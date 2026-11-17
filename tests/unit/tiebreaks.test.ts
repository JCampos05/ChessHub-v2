import { describe, expect, it } from 'vitest';
import { computeScores, type PlayedPairing } from '../../src/domain/swiss/scores.js';
import { directEncounterCriterion as directEncounterValues } from '../../src/domain/tiebreaks/type-tiebreaks.js';
import {
  buildStats,
  criterionValue,
  DEFAULT_TIEBREAK_ORDER,
  PLAYER_CRITERIA,
  TIEBREAK_CRITERIA,
} from '../../src/domain/tiebreaks/criteria.js';
import { rankStandings } from '../../src/domain/tiebreaks/standings.js';

const game = (
  roundNumber: number,
  whiteId: string,
  blackId: string | null,
  result: PlayedPairing['result'],
): PlayedPairing => ({ roundNumber, whiteId, blackId, result });

// Round robin de 4 jugadores calculado a mano (P-41):
//   R1  A-B 1-0   C-D 1/2   R2  A-C 1/2   B-D 1-0   R3  A-D 1-0   B-C 0-1 (C con negras)
// Puntos: A 2.5, B 1, C 2, D 0.5
const roundRobin: PlayedPairing[] = [
  game(1, 'A', 'B', 'WHITE_WINS'),
  game(1, 'C', 'D', 'DRAW'),
  game(2, 'A', 'C', 'DRAW'),
  game(2, 'B', 'D', 'WHITE_WINS'),
  game(3, 'A', 'D', 'WHITE_WINS'),
  game(3, 'B', 'C', 'BLACK_WINS'),
];

const players = ['A', 'B', 'C', 'D'].map((id, index) => ({ id, folio: index + 1 }));

describe('criterios de desempate (P-41)', () => {
  const scores = computeScores(roundRobin);
  const stats = buildStats(roundRobin);
  const value = (criterion: Parameters<typeof criterionValue>[0], id: string) =>
    criterionValue(criterion, stats.get(id), scores);

  it('cada criterio del catalogo tiene su funcion (salvo el enfrentamiento directo, que es de grupo)', () => {
    const individual = TIEBREAK_CRITERIA.filter((c) => c !== 'DIRECT_ENCOUNTER');
    expect(Object.keys(PLAYER_CRITERIA).sort()).toEqual([...individual].sort());
    for (const criterion of DEFAULT_TIEBREAK_ORDER) expect(TIEBREAK_CRITERIA).toContain(criterion);
  });

  it('los puntos de partida son los esperados', () => {
    expect([...'ABCD'].map((id) => scores.get(id))).toEqual([2.5, 1, 2, 0.5]);
  });

  it('Buchholz: suma de los puntajes de los rivales', () => {
    expect([...'ABCD'].map((id) => value('BUCHHOLZ', id))).toEqual([3.5, 5, 4, 5.5]);
  });

  it('Buchholz corte 1: sin el rival de menor puntaje', () => {
    expect([...'ABCD'].map((id) => value('BUCHHOLZ_CUT1', id))).toEqual([3, 4.5, 3.5, 4.5]);
  });

  it('Buchholz mediano 1: sin el mayor y el menor', () => {
    expect([...'ABCD'].map((id) => value('BUCHHOLZ_MEDIAN1', id))).toEqual([1, 2, 1, 2]);
  });

  it('Buchholz mediano 1 vale 0 con dos rivales o menos', () => {
    const short = [game(1, 'A', 'B', 'WHITE_WINS'), game(2, 'C', 'A', 'DRAW')];
    const shortScores = computeScores(short);
    expect(criterionValue('BUCHHOLZ_MEDIAN1', buildStats(short).get('A'), shortScores)).toBe(0);
  });

  it('Sonneborn-Berger: puntaje del rival si se ganó, la mitad si hubo tablas', () => {
    expect([...'ABCD'].map((id) => value('SONNEBORN_BERGER', id))).toEqual([2.5, 0.5, 2.5, 1]);
  });

  it('victorias jugadas y victorias con negras', () => {
    expect([...'ABCD'].map((id) => value('WINS', id))).toEqual([2, 1, 1, 0]);
    expect([...'ABCD'].map((id) => value('BLACK_WINS', id))).toEqual([0, 0, 1, 0]);
  });

  it('puntaje progresivo: suma de los puntajes tras cada ronda', () => {
    // A: 1 + 1.5 + 2.5 · B: 0 + 1 + 1 · C: 0.5 + 1 + 2 · D: 0.5 + 0.5 + 0.5
    expect([...'ABCD'].map((id) => value('PROGRESSIVE', id))).toEqual([5, 2, 3.5, 1.5]);
  });

  it('un jugador sin partidas vale 0 en todos los criterios', () => {
    for (const criterion of ['BUCHHOLZ', 'BUCHHOLZ_CUT1', 'BUCHHOLZ_MEDIAN1', 'SONNEBORN_BERGER', 'WINS', 'BLACK_WINS', 'PROGRESSIVE'] as const) {
      expect(criterionValue(criterion, undefined, scores)).toBe(0);
    }
  });

  it('enfrentamiento directo: aplica solo si todos los del grupo jugaron entre sí', () => {
    expect(directEncounterValues(['A', 'B'], stats)).toEqual(
      new Map([
        ['A', 1],
        ['B', 0],
      ]),
    );
    expect(directEncounterValues(['A', 'B', 'C'], stats)?.get('C')).toBe(1.5);
    const partial = buildStats([game(1, 'A', 'B', 'WHITE_WINS'), game(1, 'C', 'D', 'DRAW')]);
    expect(directEncounterValues(['A', 'B', 'C'], partial)).toBeNull();
  });
});

describe('clasificación derivada (P-41)', () => {
  it('ordena por puntos cuando no hay empates', () => {
    const standings = rankStandings(players, roundRobin);
    expect(standings.map((s) => [s.playerId, s.position, s.points])).toEqual([
      ['A', 1, 2.5],
      ['C', 2, 2],
      ['B', 3, 1],
      ['D', 4, 0.5],
    ]);
  });

  // Variante con tablas en la ronda 3: A 2, B 1.5, C 1.5, D 1; B y C empatan en puntos, Buchholz y corte 1
  const tied: PlayedPairing[] = [
    game(1, 'A', 'B', 'WHITE_WINS'),
    game(1, 'C', 'D', 'DRAW'),
    game(2, 'A', 'C', 'DRAW'),
    game(2, 'B', 'D', 'WHITE_WINS'),
    game(3, 'A', 'D', 'DRAW'),
    game(3, 'B', 'C', 'DRAW'),
  ];

  it('rompe el empate con el primer desempate que los separa (Sonneborn-Berger)', () => {
    const standings = rankStandings(players, tied);
    expect(standings.map((s) => s.playerId)).toEqual(['A', 'C', 'B', 'D']);
    expect(standings.map((s) => s.position)).toEqual([1, 2, 3, 4]);

    const byId = new Map(standings.map((s) => [s.playerId, s]));
    expect(byId.get('B')?.tiebreaks.BUCHHOLZ).toBe(4.5);
    expect(byId.get('C')?.tiebreaks.BUCHHOLZ).toBe(4.5);
    expect(byId.get('C')?.tiebreaks.SONNEBORN_BERGER).toBe(2.25);
    expect(byId.get('B')?.tiebreaks.SONNEBORN_BERGER).toBe(1.75);
  });

  it('el orden de desempates es configurable', () => {
    // Por victorias: B tiene 1 y C ninguna, así que B pasa a C
    const standings = rankStandings(players, tied, ['WINS']);
    expect(standings.map((s) => s.playerId)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('los empatados en todo comparten posición y se presentan por folio', () => {
    const standings = rankStandings(players, tied, ['DIRECT_ENCOUNTER']);
    // B y C empataron entre sí: el enfrentamiento directo no los separa
    expect(standings.map((s) => [s.playerId, s.position])).toEqual([
      ['A', 1],
      ['B', 2],
      ['C', 2],
      ['D', 4],
    ]);
  });

  it('el enfrentamiento directo separa a dos empatados', () => {
    // P y Q suman 1; P ganó la partida entre ambos
    const history = [
      game(1, 'P', 'Q', 'WHITE_WINS'),
      game(1, 'R', 'S', 'DRAW'),
      game(2, 'P', 'R', 'BLACK_WINS'),
      game(2, 'Q', 'S', 'WHITE_WINS'),
    ];
    // Q tiene el folio menor: el enfrentamiento directo debe pesar más que el folio
    const four = [
      { id: 'P', folio: 2 },
      { id: 'Q', folio: 1 },
      { id: 'R', folio: 3 },
      { id: 'S', folio: 4 },
    ];
    const standings = rankStandings(four, history, ['DIRECT_ENCOUNTER']);
    expect(standings.map((s) => s.playerId)).toEqual(['R', 'P', 'Q', 'S']);
    expect(standings.map((s) => s.position)).toEqual([1, 2, 3, 4]);
  });

  it('si no todos los empatados jugaron entre sí se pasa al siguiente criterio', () => {
    // A y C empatan en 1 punto sin haberse enfrentado; C ganó con negras
    const history = [game(1, 'A', 'B', 'WHITE_WINS'), game(1, 'D', 'C', 'BLACK_WINS')];
    const standings = rankStandings(players, history, ['DIRECT_ENCOUNTER', 'BLACK_WINS']);
    expect(standings.slice(0, 2).map((s) => s.playerId)).toEqual(['C', 'A']);
  });

  it('descanso (bye): suma su punto pero no aporta rival ni victoria jugada', () => {
    // A gana a B; C descansa. A y C tienen 1 punto
    const history = [game(1, 'A', 'B', 'WHITE_WINS'), game(1, 'C', null, 'PENDING')];
    const standings = rankStandings(['A', 'B', 'C'].map((id, i) => ({ id, folio: i + 1 })), history, ['BUCHHOLZ', 'WINS']);
    expect(standings.map((s) => [s.playerId, s.position, s.points])).toEqual([
      ['A', 1, 1],
      ['C', 2, 1],
      ['B', 3, 0],
    ]);
    const byId = new Map(standings.map((s) => [s.playerId, s]));
    expect(byId.get('C')?.tiebreaks.BUCHHOLZ).toBe(0);
    expect(byId.get('C')?.tiebreaks.WINS).toBe(0);
    expect(byId.get('A')?.tiebreaks.WINS).toBe(1);
  });

  it('una mesa sin resultado no aporta rivales ni puntos', () => {
    const history = [game(1, 'A', 'B', 'PENDING')];
    const standings = rankStandings(players.slice(0, 2), history);
    expect(standings.map((s) => [s.position, s.points])).toEqual([
      [1, 0],
      [1, 0],
    ]);
  });

  it('incluye a los jugadores sin partidas y no repite a los duplicados', () => {
    const standings = rankStandings([...players, players[0]!], roundRobin.slice(0, 1));
    expect(standings).toHaveLength(4);
    expect(standings.at(-1)?.points).toBe(0);
  });

  it('es determinista: mismo insumo, misma clasificación', () => {
    const again = rankStandings([...players].reverse(), [...roundRobin].reverse(), DEFAULT_TIEBREAK_ORDER);
    expect(again).toEqual(rankStandings(players, roundRobin, DEFAULT_TIEBREAK_ORDER));
  });
});
