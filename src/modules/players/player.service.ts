import { nameKey } from '../../domain/name-matching/name-key.js';
import { normalizeName } from '../../domain/name-matching/normalize.js';
import { conflict, notFound } from '../../shared/errors.js';
import {
  toPrivatePlayerDto,
  toPublicPlayerDto,
  type PrivatePlayerDto,
  type PublicPlayerDto,
} from './player.dto.js';
import { playerRepository } from './player.repository.js';
import type { CreatePlayerInput } from './player.schemas.js';

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

async function canReadPrivate(userId: string): Promise<boolean> {
  return playerRepository.userHasRole(userId, 'SUPER_ADMIN');
}

export const playerService = {
  async create(input: CreatePlayerInput, createdById: string): Promise<PrivatePlayerDto> {
    const key = nameKey(input.fullName);
    const birthDate = input.birthDate ? new Date(`${input.birthDate}T00:00:00.000Z`) : null;

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
      return toPrivatePlayerDto(player);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict('PLAYER_DUPLICATE', 'Ya existe un jugador con esos datos de identificación');
      }
      throw error;
    }
  },

  async getById(id: string, requesterId: string): Promise<PublicPlayerDto | PrivatePlayerDto> {
    const player = await playerRepository.findById(id);
    if (!player) throw notFound('El jugador no existe');
    return (await canReadPrivate(requesterId)) ? toPrivatePlayerDto(player) : toPublicPlayerDto(player);
  },
};
