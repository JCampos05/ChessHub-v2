import { ageOn } from '../../domain/age/age.js';
import { cache } from '../../lib/cache.js';
import { conflict, notFound, referenceNotFound } from '../../shared/errors.js';
import { fromDateOnly } from '../../shared/dates.js';
import { paginate } from '../../shared/pagination.js';
import { isUniqueViolation } from '../../shared/prisma-errors.js';
import { tournamentRepository } from '../tournaments/tournament.repository.js';
import { TOURNAMENT_CACHE_RESOURCE } from '../tournaments/tournament.service.js';
import { isFrozen } from '../tournaments/tournament-status.js';
import { toRegistrationDto, type RegistrationDto } from './registration.dto.js';
import { registrationRepository } from './registration.repository.js';
import type { CreateRegistrationInput, ListRegistrationsQuery } from './registration.schemas.js';

async function requireTournament(id: string) {
  const tournament = await tournamentRepository.findById(id);
  if (!tournament?.isActive) throw notFound('El torneo no existe');
  return tournament;
}

async function requireRegistration(tournamentId: string, id: string) {
  const registration = await registrationRepository.findInTournament(tournamentId, id);
  if (!registration) throw notFound('La inscripción no existe');
  return registration;
}

const closed = () => conflict('REGISTRATION_CLOSED', 'El torneo no admite inscripciones');
const full = () => conflict('CAPACITY_FULL', 'El torneo ya no tiene cupo disponible');
const alreadyRegistered = () => conflict('ALREADY_REGISTERED', 'El jugador ya está inscrito en este torneo');

export const registrationService = {
  async create(tournamentId: string, input: CreateRegistrationInput, userId: string): Promise<RegistrationDto> {
    const tournament = await requireTournament(tournamentId);
    if (tournament.status !== 'REGISTRATION_OPEN') throw closed();

    const link = await registrationRepository.findLink(tournamentId, input.categoryId);
    if (!link?.category.isActive) {
      throw referenceNotFound('categoryId', 'La categoría no existe o no está vinculada al torneo');
    }

    const player = await registrationRepository.findPlayer(input.playerId);
    if (!player || player.status === 'INACTIVE') {
      throw referenceNotFound('playerId', 'El jugador no existe o está inactivo');
    }

    // Edad cumplida a la fecha de inicio del torneo 
    const { minAge, maxAge } = link.category;
    if (minAge !== null || maxAge !== null) {
      if (!player.birthDate) {
        throw conflict('AGE_NOT_ELIGIBLE', 'La categoría tiene límite de edad y el jugador no tiene fecha de nacimiento');
      }
      const age = ageOn(fromDateOnly(player.birthDate), fromDateOnly(tournament.startDate));
      if ((minAge !== null && age < minAge) || (maxAge !== null && age > maxAge)) {
        throw conflict('AGE_NOT_ELIGIBLE', 'La edad del jugador no corresponde a la categoría');
      }
    }

    try {
      const result = await registrationRepository.reserveAndCreate({
        tournamentId,
        categoryId: input.categoryId,
        playerId: input.playerId,
        createdById: userId,
      });
      if (!result.ok) throw result.reason === 'FULL' ? full() : closed();
      await cache.bump(TOURNAMENT_CACHE_RESOURCE);
      return toRegistrationDto(result.registration);
    } catch (error) {
      // El índice único parcial gana si dos peticiones inscriben al mismo jugador a la vez; la transacción ya se revirtió
      if (isUniqueViolation(error)) throw alreadyRegistered();
      throw error;
    }
  },

  async list(tournamentId: string, query: ListRegistrationsQuery) {
    await requireTournament(tournamentId);
    const { rows, total } = await registrationRepository.list(tournamentId, query);
    return paginate(rows.map(toRegistrationDto), query.page, query.limit, total);
  },

  async cancel(tournamentId: string, id: string, userId: string): Promise<RegistrationDto> {
    const tournament = await requireTournament(tournamentId);
    if (isFrozen(tournament.status)) {
      throw conflict('TOURNAMENT_NOT_EDITABLE', 'El torneo ya terminó o fue cancelado y no admite cambios');
    }
    await requireRegistration(tournamentId, id);
    // Cancelar de nuevo no libera otro cupo: la operación es idempotente
    if (await registrationRepository.cancel(tournamentId, id, userId)) await cache.bump(TOURNAMENT_CACHE_RESOURCE);
    return toRegistrationDto(await requireRegistration(tournamentId, id));
  },

  async confirmPayment(tournamentId: string, id: string, userId: string): Promise<RegistrationDto> {
    await requireTournament(tournamentId);
    const current = await requireRegistration(tournamentId, id);
    if (current.status === 'CANCELLED') {
      throw conflict('REGISTRATION_CANCELLED', 'La inscripción está cancelada y no admite pagos');
    }
    if (!(await registrationRepository.confirmPayment(tournamentId, id, userId))) {
      throw conflict('PAYMENT_ALREADY_CONFIRMED', 'El pago de esta inscripción ya fue confirmado');
    }
    return toRegistrationDto(await requireRegistration(tournamentId, id));
  },
};
