import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import type { PlannedPairing } from '../../domain/swiss/pair.js';

export type Tx = Prisma.TransactionClient;

const TX_OPTIONS = { maxWait: 15_000, timeout: 30_000 } as const;

export const roundGenerationRepository = {
  // Ejecuta el trabajo dentro de una transacción con el torneo bloqueado: dos generaciones del mismo torneo
  // se serializan y la segunda ve lo que dejó la primera. Prisma no tiene bloqueo explícito; escribir la fila del
  // torneo toma su candado exclusivo hasta el commit (igual que FOR UPDATE) y bloquea también las inscripciones
  // que intenten reservar cupo mientras se empareja
  runLocked<T>(tournamentId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.tournament.updateMany({ where: { id: tournamentId }, data: { updatedAt: new Date() } });
      return work(tx);
    }, TX_OPTIONS);
  },

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
