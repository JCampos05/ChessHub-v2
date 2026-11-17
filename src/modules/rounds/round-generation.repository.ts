import type { PlannedPairing } from '../../domain/swiss/pair.js';
import { runWithTournamentLocked, type Tx } from '../tournaments/tournament-lock.js';

export type { Tx };

export const roundGenerationRepository = {
  // Dos generaciones del mismo torneo se serializan con su candado (ver tournament-lock.ts)
  runLocked: runWithTournamentLocked,

  findTournament(tx: Tx, id: string) {
    return tx.tournament.findUnique({ where: { id } });
  },

  // Todas las rondas del torneo (también las inactivas, que siguen ocupando su número), de la más reciente a la más antigua
  findRounds(tx: Tx, tournamentId: string) {
    return tx.round.findMany({ where: { tournamentId }, orderBy: { number: 'desc' } });
  },

  findPairings(tx: Tx, tournamentId: string) {
    return tx.pairing.findMany({
      where: { tournamentId, isActive: true, round: { isActive: true } },
      include: { game: { select: { result: true, isActive: true } } },
      orderBy: [{ roundNumber: 'asc' }, { board: 'asc' }],
    });
  },

  findActiveRegistrations(tx: Tx, tournamentId: string) {
    return tx.registration.findMany({
      where: { tournamentId, status: 'ACTIVE' },
      select: { playerId: true, folio: true, player: { select: { ratingElo: true } } },
      orderBy: { folio: 'asc' },
    });
  },

  // Historial de ratings de los jugadores; la vigencia y el respaldo los resuelve el dominio
  findRatings(tx: Tx, playerIds: string[]) {
    return tx.playerRating.findMany({ where: { playerId: { in: playerIds } } });
  },

  closeRound(tx: Tx, tournamentId: string, number: number) {
    return tx.round.update({
      where: { tournamentId_number: { tournamentId, number } },
      data: { status: 'FINISHED', finishedAt: new Date() },
    });
  },

  createRound(tx: Tx, tournamentId: string, number: number) {
    return tx.round.create({ data: { tournamentId, number, status: 'IN_PROGRESS', startedAt: new Date() } });
  },

  // Crea la mesa con su partida pendiente; el descanso (sin negras) no lleva partida
  createPairing(tx: Tx, tournamentId: string, roundNumber: number, planned: PlannedPairing) {
    const { whiteId, blackId } = planned;
    return tx.pairing.create({
      data: {
        tournamentId,
        roundNumber,
        board: planned.board,
        whitePlayerId: whiteId,
        blackPlayerId: blackId,
        origin: 'AUTO',
        ...(blackId === null
          ? {}
          : { game: { create: { tournamentId, roundNumber, whitePlayerId: whiteId, blackPlayerId: blackId } } }),
      },
    });
  },
};
