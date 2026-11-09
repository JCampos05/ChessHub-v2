import { normalizeName } from '../../domain/name-matching/normalize.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { toSkipTake } from '../../shared/pagination.js';
import type { ListPlayersQuery } from './player.schemas.js';

export interface NewPlayer {
  fullName: string;
  normalizedName: string;
  nameKey: string;
  birthDate: Date | null;
  sex: string | null;
  federation: string;
  fideId: string | null;
  nationalId: string | null;
  clubCode: string | null;
  email: string | null;
  phone: string | null;
  createdById: string;
}

export const playerRepository = {
  create(data: NewPlayer) {
    return prisma.player.create({ data });
  },

  findById(id: string) {
    return prisma.player.findUnique({ where: { id } });
  },

  // Busca otro jugador con la misma llave de nombre (y fecha, si se conoce). `excludeId` evita chocar consigo mismo
  findDuplicate(nameKey: string, birthDate: Date | null, excludeId?: string) {
    return prisma.player.findFirst({
      where: {
        ...(birthDate ? { nameKey, birthDate } : { nameKey }),
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
  },

  update(id: string, data: Prisma.PlayerUncheckedUpdateInput) {
    return prisma.player.update({ where: { id }, data });
  },

  async list(query: ListPlayersQuery) {
    const rating: Prisma.DecimalNullableFilter = {
      ...(query.ratingMin === undefined ? {} : { gte: query.ratingMin }),
      ...(query.ratingMax === undefined ? {} : { lte: query.ratingMax }),
    };
    const where: Prisma.PlayerWhereInput = {
      ...(query.status ? { status: query.status } : query.includeInactive ? {} : { status: { not: 'INACTIVE' } }),
      ...(query.club ? { clubCode: { equals: query.club, mode: 'insensitive' } } : {}),
      ...(query.federation ? { federation: query.federation } : {}),
      ...(Object.keys(rating).length > 0 ? { ratingElo: rating } : {}),
      ...(query.q
        ? {
            OR: [
              { fullName: { contains: query.q, mode: 'insensitive' } },
              { normalizedName: { contains: normalizeName(query.q), mode: 'insensitive' } },
              { fideId: { equals: query.q } },
            ],
          }
        : {}),
    };
    // Los jugadores sin rating siempre quedan al final
    const orderBy: Prisma.PlayerOrderByWithRelationInput[] = [
      query.sortBy === 'ratingElo'
        ? { ratingElo: { sort: query.order, nulls: 'last' } }
        : { [query.sortBy]: query.order },
      { id: 'asc' },
    ];
    const [rows, total] = await prisma.$transaction([
      prisma.player.findMany({ where, orderBy, ...toSkipTake(query.page, query.limit) }),
      prisma.player.count({ where }),
    ]);
    return { rows, total };
  },
};
