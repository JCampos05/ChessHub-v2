import { cache } from '../../lib/cache.js';
import { badRequest, conflict, notFound, referenceNotFound } from '../../shared/errors.js';
import { fromDateOnly, toDateOnly } from '../../shared/dates.js';
import { paginate } from '../../shared/pagination.js';
import { isForeignKeyViolation } from '../../shared/prisma-errors.js';
import { toCategoryDto, type CategoryDto } from '../categories/category.dto.js';
import { categoryRepository } from '../categories/category.repository.js';
import { toTournamentDto, type TournamentDto } from './tournament.dto.js';
import { tournamentRepository } from './tournament.repository.js';
import {
  hasValidDateRange,
  type CreateTournamentInput,
  type ListTournamentsQuery,
  type UpdateTournamentInput,
} from './tournament.schemas.js';
import { isFrozen, isRunning } from './tournament-status.js';

const notEditable = () =>
  conflict('TOURNAMENT_NOT_EDITABLE', 'El torneo ya terminó o fue cancelado y no admite cambios');

async function requireTournament(id: string) {
  const tournament = await tournamentRepository.findById(id);
  if (!tournament) throw notFound('El torneo no existe');
  return tournament;
}

// Recurso de caché: toda escritura que cambie un torneo o sus categorías vinculadas lo invalida 
export const TOURNAMENT_CACHE_RESOURCE = 'tournaments';

export const tournamentService = {
  list(query: ListTournamentsQuery) {
    return cache.getOrLoad(TOURNAMENT_CACHE_RESOURCE, { op: 'list', query }, async () => {
      const { rows, total } = await tournamentRepository.list(query);
      return paginate(rows.map(toTournamentDto), query.page, query.limit, total);
    });
  },

  getById(id: string): Promise<TournamentDto> {
    return cache.getOrLoad(TOURNAMENT_CACHE_RESOURCE, { op: 'get', id }, async () =>
      toTournamentDto(await requireTournament(id)),
    );
  },

  async create(input: CreateTournamentInput, createdById: string): Promise<TournamentDto> {
    const tournament = await tournamentRepository.create({
      ...input,
      startDate: toDateOnly(input.startDate),
      endDate: toDateOnly(input.endDate),
      createdById,
    });
    await cache.bump(TOURNAMENT_CACHE_RESOURCE);
    return toTournamentDto(tournament);
  },

  async update(id: string, input: UpdateTournamentInput): Promise<TournamentDto> {
    const current = await requireTournament(id);
    if (isFrozen(current.status)) throw notEditable();

    // El rango de fechas se valida con los valores resultantes, no solo con los enviados
    const range = {
      startDate: input.startDate ?? fromDateOnly(current.startDate),
      endDate: input.endDate ?? fromDateOnly(current.endDate),
    };
    if (!hasValidDateRange(range)) {
      throw badRequest(
        'Los datos enviados no son válidos',
        [{ field: 'endDate', message: 'La fecha de fin no puede ser anterior a la de inicio' }],
        'INVALID_DATE_RANGE',
      );
    }

    const { startDate, endDate, ...rest } = input;
    const updated = await tournamentRepository.update(id, {
      ...rest,
      ...(startDate === undefined ? {} : { startDate: toDateOnly(startDate) }),
      ...(endDate === undefined ? {} : { endDate: toDateOnly(endDate) }),
    });
    await cache.bump(TOURNAMENT_CACHE_RESOURCE);
    return toTournamentDto(updated);
  },

  async deactivate(id: string): Promise<TournamentDto> {
    const current = await requireTournament(id);
    if (!current.isActive) return toTournamentDto(current);
    if (isRunning(current.status)) {
      throw conflict('TOURNAMENT_NOT_EDITABLE', 'El torneo está en juego y no puede darse de baja');
    }
    const updated = await tournamentRepository.update(id, { isActive: false });
    await cache.bump(TOURNAMENT_CACHE_RESOURCE);
    return toTournamentDto(updated);
  },

  async listCategories(id: string): Promise<CategoryDto[]> {
    await requireTournament(id);
    return (await tournamentRepository.listCategories(id)).map(toCategoryDto);
  },

  async linkCategory(id: string, categoryId: string): Promise<CategoryDto> {
    const tournament = await requireTournament(id);
    if (isFrozen(tournament.status)) throw notEditable();

    const category = await categoryRepository.findById(categoryId);
    if (!category?.isActive) throw referenceNotFound('categoryId', 'La categoría no existe o está inactiva');

    try {
      await tournamentRepository.linkCategory(id, categoryId);
      await cache.bump(TOURNAMENT_CACHE_RESOURCE);
    } catch (error) {
      if (isForeignKeyViolation(error)) throw referenceNotFound('categoryId', 'La categoría no existe');
      throw error;
    }
    return toCategoryDto(category);
  },

  async unlinkCategory(id: string, categoryId: string): Promise<{ message: string }> {
    const tournament = await requireTournament(id);
    if (isFrozen(tournament.status)) throw notEditable();
    await tournamentRepository.unlinkCategory(id, categoryId);
    await cache.bump(TOURNAMENT_CACHE_RESOURCE);
    return { message: 'Categoría desvinculada del torneo' };
  },
};
