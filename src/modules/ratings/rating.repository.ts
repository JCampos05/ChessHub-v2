import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { toSkipTake } from '../../shared/pagination.js';
import type { ListRatingsQuery } from './rating.schemas.js';

export const ratingRepository = {
  create(data: Prisma.PlayerRatingUncheckedCreateInput) {
    return prisma.playerRating.create({ data });
  },

  async list(playerId: string, query: ListRatingsQuery) {
    const where: Prisma.PlayerRatingWhereInput = {
      playerId,
      ...(query.system ? { system: query.system } : {}),
      ...(query.pace ? { pace: query.pace } : {}),
    };
    const [rows, total] = await prisma.$transaction([
      prisma.playerRating.findMany({
        where,
        orderBy: [{ [query.sortBy]: query.order }, { id: 'asc' }],
        ...toSkipTake(query.page, query.limit),
      }),
      prisma.playerRating.count({ where }),
    ]);
    return { rows, total };
  },
};
