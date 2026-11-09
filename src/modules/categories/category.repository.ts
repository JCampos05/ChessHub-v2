import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { toSkipTake } from '../../shared/pagination.js';
import type { ListCategoriesQuery } from './category.schemas.js';

export const categoryRepository = {
  create(data: Prisma.CategoryUncheckedCreateInput) {
    return prisma.category.create({ data });
  },

  findById(id: string) {
    return prisma.category.findUnique({ where: { id } });
  },

  // El nombre es único sin distinguir mayúsculas
  findByName(name: string) {
    return prisma.category.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
  },

  update(id: string, data: Prisma.CategoryUncheckedUpdateInput) {
    return prisma.category.update({ where: { id }, data });
  },

  async list(query: ListCategoriesQuery) {
    const where: Prisma.CategoryWhereInput = {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
      ...(query.usaElo === undefined ? {} : { usesElo: query.usaElo }),
    };
    const [rows, total] = await prisma.$transaction([
      prisma.category.findMany({
        where,
        orderBy: [{ [query.sortBy]: query.order }, { id: 'asc' }],
        ...toSkipTake(query.page, query.limit),
      }),
      prisma.category.count({ where }),
    ]);
    return { rows, total };
  },
};
