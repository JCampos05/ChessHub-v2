import { prisma } from '../../../lib/prisma.js';
import { toSkipTake } from '../../../shared/pagination.js';
import type { TournamentStatusCode } from '../tournament-status.js';
import { runWithTournamentLocked, type Tx } from '../tournament-lock.js';

export const tournamentStateRepository = {
  // Una transición se serializa con las demás operaciones del torneo (ver tournament-lock.ts)
  runLocked: runWithTournamentLocked,

  findTournament(tx: Tx, id: string) {
    return tx.tournament.findUnique({ where: { id } });
  },

  countActiveRegistrations(tx: Tx, tournamentId: string) {
    return tx.registration.count({ where: { tournamentId, status: 'ACTIVE' } });
  },

  countFinishedRounds(tx: Tx, tournamentId: string) {
    return tx.round.count({ where: { tournamentId, isActive: true, status: 'FINISHED' } });
  },

  // Ronda activa de mayor número: es la «abierta» si no está terminada
  findLastRound(tx: Tx, tournamentId: string) {
    return tx.round.findFirst({ where: { tournamentId, isActive: true }, orderBy: { number: 'desc' } });
  },

  countPairings(tx: Tx, tournamentId: string, roundNumber: number) {
    return tx.pairing.count({ where: { tournamentId, roundNumber, isActive: true } });
  },

  // Mesas con negras cuya partida activa no tiene resultado o no existe; los descansos no cuentan
  countPendingGames(tx: Tx, tournamentId: string, roundNumber: number) {
    return tx.pairing.count({
      where: {
        tournamentId,
        roundNumber,
        isActive: true,
        blackPlayerId: { not: null },
        OR: [{ game: { is: null } }, { game: { isActive: false } }, { game: { result: 'PENDING' } }],
      },
    });
  },

  startRound(tx: Tx, roundId: string, startedAt: Date) {
    return tx.round.update({ where: { id: roundId }, data: { status: 'IN_PROGRESS', startedAt } });
  },

  finishRound(tx: Tx, roundId: string) {
    return tx.round.update({ where: { id: roundId }, data: { status: 'FINISHED', finishedAt: new Date() } });
  },

  updateStatus(tx: Tx, id: string, status: TournamentStatusCode) {
    return tx.tournament.update({ where: { id }, data: { status } });
  },

  createChange(
    tx: Tx,
    data: { tournamentId: string; from: TournamentStatusCode; to: TournamentStatusCode; changedById: string; reason: string | undefined },
  ) {
    return tx.stateChange.create({
      data: {
        entityType: 'TOURNAMENT',
        entityId: data.tournamentId,
        fromState: data.from,
        toState: data.to,
        changedById: data.changedById,
        reason: data.reason ?? null,
      },
    });
  },

  async listChanges(tournamentId: string, page: number, limit: number) {
    const where = { entityType: 'TOURNAMENT' as const, entityId: tournamentId };
    const [rows, total] = await Promise.all([
      prisma.stateChange.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...toSkipTake(page, limit),
      }),
      prisma.stateChange.count({ where }),
    ]);
    return { rows, total };
  },
};
