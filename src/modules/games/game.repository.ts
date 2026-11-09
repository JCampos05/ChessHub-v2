import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { toSkipTake } from '../../shared/pagination.js';
import type { ListGamesQuery } from './game.schemas.js';

export const gameRepository = {
  create(data: Prisma.GameUncheckedCreateInput) {
    return prisma.game.create({ data });
  },

  findById(id: string) {
    return prisma.game.findUnique({ where: { id } });
  },

  update(id: string, data: Prisma.GameUncheckedUpdateInput) {
    return prisma.game.update({ where: { id }, data });
  },

  findPairing(id: string) {
    return prisma.pairing.findUnique({ where: { id } });
  },

  findPlayers(ids: string[]) {
    return prisma.player.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } });
  },

  async list(query: ListGamesQuery) {
    const where: Prisma.GameWhereInput = {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.tournamentId ? { tournamentId: query.tournamentId } : {}),
      ...(query.roundNumber ? { roundNumber: query.roundNumber } : {}),
      ...(query.result ? { result: query.result } : {}),
      ...(query.playerId ? { OR: [{ whitePlayerId: query.playerId }, { blackPlayerId: query.playerId }] } : {}),
    };
    const [rows, total] = await prisma.$transaction([
      prisma.game.findMany({
        where,
        orderBy: [{ [query.sortBy]: query.order }, { id: 'asc' }],
        ...toSkipTake(query.page, query.limit),
      }),
      prisma.game.count({ where }),
    ]);
    return { rows, total };
  },
};
