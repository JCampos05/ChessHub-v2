import { badRequest, conflict, notFound, referenceNotFound } from '../../shared/errors.js';
import { paginate } from '../../shared/pagination.js';
import { isForeignKeyViolation, isUniqueViolation } from '../../shared/prisma-errors.js';
import { requireTournamentAccess } from '../tournaments/tournament.access.js';
import { toRoundDto, type RoundDto } from './round.dto.js';
import { roundRepository } from './round.repository.js';
import type { CreateRoundInput, ListRoundsQuery, UpdateRoundInput } from './round.schemas.js';

const duplicated = () =>
  conflict('ROUND_DUPLICATE', 'El torneo ya tiene una ronda con ese número (puede estar inactiva)');

const notEditable = () =>
  conflict('ROUND_NOT_EDITABLE', 'La ronda ya se inició o terminó y no admite cambios');

async function requireRound(id: string) {
  const round = await roundRepository.findById(id);
  if (!round) throw notFound('La ronda no existe');
  return round;
}

export const roundService = {
  async list(query: ListRoundsQuery) {
    const { rows, total } = await roundRepository.list(query);
    return paginate(rows.map(toRoundDto), query.page, query.limit, total);
  },

  async getById(id: string): Promise<RoundDto> {
    return toRoundDto(await requireRound(id));
  },

  async create(input: CreateRoundInput, userId: string): Promise<RoundDto> {
    const tournament = await requireTournamentAccess(userId, input.tournamentId, 'round:manage');

    if (tournament.roundsPlanned !== null && input.number > tournament.roundsPlanned) {
      throw badRequest('Los datos enviados no son válidos', [
        { field: 'number', message: `El torneo tiene planeadas ${tournament.roundsPlanned} rondas` },
      ]);
    }
    if (await roundRepository.findByNumber(input.tournamentId, input.number)) throw duplicated();

    try {
      return toRoundDto(await roundRepository.create(input));
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicated();
      if (isForeignKeyViolation(error)) throw referenceNotFound('tournamentId', 'El torneo no existe');
      throw error;
    }
  },

  async update(id: string, input: UpdateRoundInput): Promise<RoundDto> {
    const current = await requireRound(id);
    if (current.status !== 'PENDING') throw notEditable();

    if (input.number !== undefined && input.number !== current.number) {
      if (await roundRepository.findByNumber(current.tournamentId, input.number)) throw duplicated();
    }
    try {
      return toRoundDto(await roundRepository.update(id, input));
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicated();
      throw error;
    }
  },

  async deactivate(id: string): Promise<RoundDto> {
    const current = await requireRound(id);
    if (!current.isActive) return toRoundDto(current);
    if (current.status !== 'PENDING') throw notEditable();
    return toRoundDto(await roundRepository.update(id, { isActive: false }));
  },
};
