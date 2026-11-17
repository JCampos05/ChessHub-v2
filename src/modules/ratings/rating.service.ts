import { conflict, notFound } from '../../shared/errors.js';
import { toDateOnly } from '../../shared/dates.js';
import { paginate } from '../../shared/pagination.js';
import { isUniqueViolation } from '../../shared/prisma-errors.js';
import { playerRepository } from '../players/player.repository.js';
import { toRatingDto, type RatingDto } from './rating.dto.js';
import { ratingRepository } from './rating.repository.js';
import type { CreateRatingInput, ListRatingsQuery } from './rating.schemas.js';

async function requirePlayer(playerId: string): Promise<void> {
  if (!(await playerRepository.findById(playerId))) throw notFound('El jugador no existe');
}

export const ratingService = {
  async list(playerId: string, query: ListRatingsQuery) {
    await requirePlayer(playerId);
    const { rows, total } = await ratingRepository.list(playerId, query);
    return paginate(rows.map(toRatingDto), query.page, query.limit, total);
  },

  // Solo inserta: el historial no se edita ni se borra. Corregir un valor es registrar otro con vigencia posterior
  async create(playerId: string, input: CreateRatingInput, createdById: string): Promise<RatingDto> {
    await requirePlayer(playerId);
    const validFrom = input.validFrom ?? new Date().toISOString().slice(0, 10);
    try {
      const rating = await ratingRepository.create({
        playerId,
        system: input.system,
        pace: input.pace,
        stateCode: input.stateCode ?? null,
        value: input.value,
        validFrom: toDateOnly(validFrom),
        createdById,
      });
      return toRatingDto(rating);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict('RATING_DUPLICATE', 'El jugador ya tiene un rating de ese sistema y ritmo con esa fecha de vigencia');
      }
      throw error;
    }
  },
};
