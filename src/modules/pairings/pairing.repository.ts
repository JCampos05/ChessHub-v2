import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { toSkipTake } from '../../shared/pagination.js';
import type { ListPairingsQuery } from './pairing.schemas.js';

export interface PairingSlot {
  tournamentId: string;
  roundNumber: number;
  board: number;
  whitePlayerId: string;
  blackPlayerId: string | null;
}

export type SlotConflict = 'BOARD_TAKEN' | 'PLAYER_ALREADY_PAIRED';

type Pairing = NonNullable<Awaited<ReturnType<typeof prisma.pairing.findUnique>>>;
export type WriteResult = { ok: true; pairing: Pairing } | { ok: false; conflict: SlotConflict };

export const pairingRepository = {
  findById(id: string) {
    return prisma.pairing.findUnique({ where: { id } });
  },

  // Crea o modifica un emparejamiento serializando las escrituras de su ronda.
  // Prisma no expone FOR UPDATE: se bloquea la ronda para que dos escrituras simultáneas no asignen al mismo jugador a dos mesas
  writeInRound(slot: PairingSlot, excludeId: string | null): Promise<WriteResult> {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM rounds
        WHERE tournament_id = ${slot.tournamentId}::uuid AND number = ${slot.roundNumber} FOR UPDATE`;

      const others: Prisma.PairingWhereInput = {
        tournamentId: slot.tournamentId,
        roundNumber: slot.roundNumber,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      };

      const boardTaken = await tx.pairing.findFirst({ where: { ...others, board: slot.board }, select: { id: true } });
      if (boardTaken) return { ok: false, conflict: 'BOARD_TAKEN' } as const;

      const playerIds = slot.blackPlayerId ? [slot.whitePlayerId, slot.blackPlayerId] : [slot.whitePlayerId];
      const playerTaken = await tx.pairing.findFirst({
        where: { ...others, OR: [{ whitePlayerId: { in: playerIds } }, { blackPlayerId: { in: playerIds } }] },
        select: { id: true },
      });
      if (playerTaken) return { ok: false, conflict: 'PLAYER_ALREADY_PAIRED' } as const;

      const pairing = excludeId
        ? await tx.pairing.update({ where: { id: excludeId }, data: slot })
        : await tx.pairing.create({ data: slot });
      return { ok: true, pairing } as const;
    });
  },

  setActive(id: string, isActive: boolean) {
    return prisma.pairing.update({ where: { id }, data: { isActive } });
  },

  findPlayers(ids: string[]) {
    return prisma.player.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } });
  },

  async list(query: ListPairingsQuery) {
    const where: Prisma.PairingWhereInput = {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.tournamentId ? { tournamentId: query.tournamentId } : {}),
      ...(query.roundNumber ? { roundNumber: query.roundNumber } : {}),
      ...(query.playerId ? { OR: [{ whitePlayerId: query.playerId }, { blackPlayerId: query.playerId }] } : {}),
    };
    const [rows, total] = await prisma.$transaction([
      prisma.pairing.findMany({
        where,
        orderBy: [{ [query.sortBy]: query.order }, { id: 'asc' }],
        ...toSkipTake(query.page, query.limit),
      }),
      prisma.pairing.count({ where }),
    ]);
    return { rows, total };
  },
};
