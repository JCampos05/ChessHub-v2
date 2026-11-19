import { prisma } from './db.js';
import { makePlayer, makeRound, makeTournament } from './factories.js';

let categorySeq = 0;

// Torneo con una categoría vinculada
export async function makeTournamentWithCategory(overrides: Parameters<typeof makeTournament>[0] = {}) {
  const tournament = await makeTournament(overrides);
  categorySeq += 1;
  const category = await prisma.category.create({ data: { name: `Categoría de prueba ${categorySeq}` } });
  await prisma.tournamentCategory.create({ data: { tournamentId: tournament.id, categoryId: category.id } });
  return { tournament, category };
}

// Inscribe a n jugadores nuevos con rating descendente (el primero es el mejor) y folios 1...n.
// Escribe con Prisma (no por la API) para preparar torneos grandes sin pasar por las reglas de alta.
export async function enrollPlayers(tournamentId: string, categoryId: string, count: number) {
  const players = [];
  for (let i = 0; i < count; i += 1) {
    const player = await makePlayer({ ratingElo: 2000 - i * 25 });
    await prisma.registration.create({
      data: { tournamentId, categoryId, playerId: player.id, folio: i + 1 },
    });
    players.push(player);
  }
  await prisma.tournament.update({
    where: { id: tournamentId },
    data: { registeredCount: { increment: count }, registrationCounter: { increment: count } },
  });
  return players;
}

// Pone el torneo en juego (la generación de rondas lo exige). Escribe con Prisma para no depender de la ruta de estados
export function startTournament(tournamentId: string) {
  return prisma.tournament.update({ where: { id: tournamentId }, data: { status: 'IN_PROGRESS' } });
}

// Ronda 1 armada a mano con una sola mesa: sirve para probar transiciones sin pasar por el generador de pareos
export async function makeManualRound(
  tournamentId: string,
  whitePlayerId: string,
  blackPlayerId: string,
  options: { status?: 'PENDING' | 'IN_PROGRESS' | 'FINISHED'; result?: 'PENDING' | 'WHITE_WINS' } = {},
) {
  const status = options.status ?? 'PENDING';
  await makeRound(tournamentId, 1, {
    status,
    ...(status === 'PENDING' ? {} : { startedAt: new Date() }),
    ...(status === 'FINISHED' ? { finishedAt: new Date() } : {}),
  });
  await prisma.pairing.create({
    data: {
      tournamentId,
      roundNumber: 1,
      board: 1,
      whitePlayerId,
      blackPlayerId,
      game: {
        create: { tournamentId, roundNumber: 1, whitePlayerId, blackPlayerId, result: options.result ?? 'PENDING' },
      },
    },
  });
}

// Da resultado a todas las partidas pendientes de una ronda (blancas ganan)
export function finishRoundGames(tournamentId: string, roundNumber: number) {
  return prisma.game.updateMany({
    where: { tournamentId, roundNumber, result: 'PENDING' },
    data: { result: 'WHITE_WINS' },
  });
}
