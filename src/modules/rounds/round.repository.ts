import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { toSkipTake } from '../../shared/pagination.js';
import type { ListRoundsQuery } from './round.schemas.js';

export const roundRepository = {
  create(data: Prisma.RoundUncheckedCreateInput) {
    return prisma.round.create({ data });
  },

  findById(id: string) {
    return prisma.round.findUnique({ where: { id } });
  },

  findByNumber(tournamentId: string, number: number) {
    return prisma.round.findUnique({ where: { tournamentId_number: { tournamentId, number } } });
  },

  update(id: string, data: Prisma.RoundUncheckedUpdateInput) {
    return prisma.round.update({ where: { id }, data });
  },

  async list(query: ListRoundsQuery) {
    const where: Prisma.RoundWhereInput = {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.tournamentId ? { tournamentId: query.tournamentId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await prisma.$transaction([
      prisma.round.findMany({
        where,
        orderBy: [{ [query.sortBy]: query.order }, { id: 'asc' }],
        ...toSkipTake(query.page, query.limit),
      }),
      prisma.round.count({ where }),
    ]);
    return { rows, total };
  },
};
