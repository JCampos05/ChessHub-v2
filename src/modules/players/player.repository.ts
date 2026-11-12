import { birthDateBounds } from '../../domain/age/age.js';
import { normalizeName } from '../../domain/name-matching/normalize.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { toDateOnly } from '../../shared/dates.js';
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
    const bounds = birthDateBounds(new Date().toISOString().slice(0, 10), { min: query.edadMin, max: query.edadMax });
    const birthDate: Prisma.DateTimeNullableFilter = {
      ...(bounds.onOrBefore ? { lte: toDateOnly(bounds.onOrBefore) } : {}),
      ...(bounds.after ? { gt: toDateOnly(bounds.after) } : {}),
    };

    // Busca por contenido en el nombre normalizado (índice de trigramas) o por FIDE exacto.
    // Si q solo tiene signos, el nombre normalizado queda vacío y solo cuenta el FIDE.
    const normalizedQuery = query.q ? normalizeName(query.q) : '';
    const textFilter: Prisma.PlayerWhereInput[] = query.q
      ? [
          {
            OR: [
              ...(normalizedQuery ? [{ normalizedName: { contains: normalizedQuery } }] : []),
              { fideId: { equals: query.q } },
            ],
          },
        ]
      : [];
    const clubFilter: Prisma.PlayerWhereInput[] = query.club
      ? [{ OR: query.club.map((club) => ({ clubCode: { equals: club, mode: 'insensitive' as const } })) }]
      : [];

    const where: Prisma.PlayerWhereInput = {
      ...(query.status ? { status: { in: query.status } } : query.includeInactive ? {} : { status: { not: 'INACTIVE' } }),
      ...(query.federation ? { federation: { in: query.federation } } : {}),
      ...(query.fideId ? { fideId: query.fideId } : {}),
      ...(query.sex ? { sex: query.sex } : {}),
      // Quien no tiene fecha de nacimiento no aparece al filtrar por edad (las comparaciones con NULL no coinciden)
      ...(Object.keys(birthDate).length > 0 ? { birthDate } : {}),
      ...(Object.keys(rating).length > 0 ? { ratingElo: rating } : {}),
      AND: [...textFilter, ...clubFilter],
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
