import { nameKey } from '../../domain/name-matching/name-key.js';
import { normalizeName } from '../../domain/name-matching/normalize.js';
import { cache } from '../../lib/cache.js';
import { toDateOnly } from '../../shared/dates.js';
import { conflict, forbidden, notFound } from '../../shared/errors.js';
import { paginate } from '../../shared/pagination.js';
import { isUniqueViolation } from '../../shared/prisma-errors.js';
import { permissionService } from '../auth/permission.service.js';
import {
  toPrivatePlayerDto,
  toPublicPlayerDto,
  type PrivatePlayerDto,
  type PublicPlayerDto,
} from './player.dto.js';
import { playerRepository } from './player.repository.js';
import type { CreatePlayerInput, ListPlayersQuery, UpdatePlayerInput } from './player.schemas.js';

// Roles que ven los datos de contacto de cualquier jugador
const PRIVATE_READERS = ['SUPER_ADMIN', 'FEDERATION_ADMIN'];

async function canReadPrivate(userId: string): Promise<boolean> {
  const assignments = await permissionService.assignmentsOf(userId);
  return assignments.some((assignment) => PRIVATE_READERS.includes(assignment.roleCode));
}

// Recurso de caché: toda escritura sobre jugadores lo invalida
export const PLAYER_CACHE_RESOURCE = 'players';

const duplicatedIdentity = () => conflict('PLAYER_DUPLICATE', 'Ya existe un jugador con esos datos de identificación');

export const playerService = {
  async create(input: CreatePlayerInput, createdById: string): Promise<PrivatePlayerDto> {
    const key = nameKey(input.fullName);
    const birthDate = input.birthDate ? toDateOnly(input.birthDate) : null;

    const duplicate = await playerRepository.findDuplicate(key, birthDate);
    if (duplicate) {
      throw conflict(
        'PLAYER_DUPLICATE',
        birthDate
          ? 'Ya existe un jugador con ese nombre y fecha de nacimiento'
          : 'Ya existe un jugador con ese nombre; indica la fecha de nacimiento o confirma que es la misma persona',
      );
    }

    try {
      const player = await playerRepository.create({
        fullName: input.fullName,
        normalizedName: normalizeName(input.fullName),
        nameKey: key,
        birthDate,
        sex: input.sex ?? null,
        federation: input.federation,
        fideId: input.fideId ?? null,
        nationalId: input.nationalId ?? null,
        clubCode: input.clubCode ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        createdById,
      });
      await cache.bump(PLAYER_CACHE_RESOURCE);
      return toPrivatePlayerDto(player);
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicatedIdentity();
      throw error;
    }
  },

  async getById(id: string, requesterId: string): Promise<PublicPlayerDto | PrivatePlayerDto> {
    const player = await playerRepository.findById(id);
    if (!player) throw notFound('El jugador no existe');
    return (await canReadPrivate(requesterId)) ? toPrivatePlayerDto(player) : toPublicPlayerDto(player);
  },

  async list(query: ListPlayersQuery, requesterId: string) {
    const load = async <T>(toDto: (player: Parameters<typeof toPublicPlayerDto>[0]) => T) => {
      const { rows, total } = await playerRepository.list(query);
      return paginate(rows.map(toDto), query.page, query.limit, total);
    };

    // La vista privada incluye correo y teléfono: nunca pasa por la caché, que es compartida entre usuarios (RN-07).
    // Solo se cachea la vista pública, que no contiene datos de contacto ni fecha de nacimiento.
    if (await canReadPrivate(requesterId)) return load(toPrivatePlayerDto);
    return cache.getOrLoad(PLAYER_CACHE_RESOURCE, { op: 'list', audience: 'public', query }, () =>
      load(toPublicPlayerDto),
    );
  },

  async update(id: string, input: UpdatePlayerInput, requesterId: string): Promise<PrivatePlayerDto> {
    const current = await playerRepository.findById(id);
    if (!current) throw notFound('El jugador no existe');

    // El perfil lo edita quien administra jugadores; el rating y el factor K, solo quien actualiza ratings (RN-05)
    const ratingFields = ['ratingElo', 'kFactor'];
    const keys = Object.keys(input);
    if (keys.some((key) => !ratingFields.includes(key)) && !(await permissionService.can(requesterId, 'player:manage'))) {
      throw forbidden('FORBIDDEN', 'No tienes permiso para modificar el perfil del jugador');
    }
    if (keys.some((key) => ratingFields.includes(key)) && !(await permissionService.can(requesterId, 'rating:update'))) {
      throw forbidden('FORBIDDEN', 'No tienes permiso para modificar el rating del jugador');
    }

    const { fullName, birthDate, ...rest } = input;
    const nextBirth = birthDate === undefined ? current.birthDate : birthDate === null ? null : toDateOnly(birthDate);

    const identityChanged = fullName !== undefined || birthDate !== undefined;
    const key = nameKey(fullName ?? current.fullName);
    if (identityChanged && (await playerRepository.findDuplicate(key, nextBirth, id))) {
      throw conflict('PLAYER_DUPLICATE', 'Ya existe otro jugador con ese nombre y fecha de nacimiento');
    }

    try {
      const player = await playerRepository.update(id, {
        ...rest,
        ...(birthDate === undefined ? {} : { birthDate: nextBirth }),
        ...(fullName === undefined
          ? {}
          : { fullName, normalizedName: normalizeName(fullName), nameKey: key }),
      });
      await cache.bump(PLAYER_CACHE_RESOURCE);
      return toPrivatePlayerDto(player);
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicatedIdentity();
      throw error;
    }
  },

  async deactivate(id: string): Promise<PrivatePlayerDto> {
    const current = await playerRepository.findById(id);
    if (!current) throw notFound('El jugador no existe');
    if (current.status === 'INACTIVE') return toPrivatePlayerDto(current);
    const updated = await playerRepository.update(id, { status: 'INACTIVE' });
    await cache.bump(PLAYER_CACHE_RESOURCE);
    return toPrivatePlayerDto(updated);
  },
};
