import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { toDateOnly } from '../../shared/dates.js';
import { toSkipTake } from '../../shared/pagination.js';
import type { ListTournamentsQuery } from './tournament.schemas.js';

export const tournamentRepository = {
  create(data: Prisma.TournamentUncheckedCreateInput) {
    return prisma.tournament.create({ data });
  },

  findById(id: string) {
    return prisma.tournament.findUnique({ where: { id } });
  },

  update(id: string, data: Prisma.TournamentUncheckedUpdateInput) {
    return prisma.tournament.update({ where: { id }, data });
  },

  async list(query: ListTournamentsQuery) {
    const startDate: Prisma.DateTimeFilter = {
      ...(query.desde ? { gte: toDateOnly(query.desde) } : {}),
      ...(query.hasta ? { lte: toDateOnly(query.hasta) } : {}),
    };
    // "Abiertas": en convocatoria y con inicio posterior a hoy (UTC)
    const today = toDateOnly(new Date().toISOString().slice(0, 10));
    const where: Prisma.TournamentWhereInput = {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.estado ? { status: { in: query.estado } } : {}),
      ...(query.abiertas ? { AND: [{ status: 'REGISTRATION_OPEN' }, { startDate: { gt: today } }] } : {}),
      ...(query.city ? { city: { equals: query.city, mode: 'insensitive' } } : {}),
      ...(query.categoryId ? { categories: { some: { categoryId: query.categoryId } } } : {}),
      ...(Object.keys(startDate).length > 0 ? { startDate } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { venue: { contains: query.q, mode: 'insensitive' } },
              { city: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await prisma.$transaction([
      prisma.tournament.findMany({
        where,
        orderBy: [{ [query.sortBy]: query.order }, { id: 'asc' }],
        ...toSkipTake(query.page, query.limit),
      }),
      prisma.tournament.count({ where }),
    ]);
    return { rows, total };
  },

  listCategories(tournamentId: string) {
    return prisma.category.findMany({
      where: { tournaments: { some: { tournamentId } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  },

  // Vincular dos veces la misma categoría no falla
  linkCategory(tournamentId: string, categoryId: string) {
    return prisma.tournamentCategory.upsert({
      where: { tournamentId_categoryId: { tournamentId, categoryId } },
      create: { tournamentId, categoryId },
      update: {},
    });
  },

  async unlinkCategory(tournamentId: string, categoryId: string): Promise<void> {
    await prisma.tournamentCategory.deleteMany({ where: { tournamentId, categoryId } });
  },
};
