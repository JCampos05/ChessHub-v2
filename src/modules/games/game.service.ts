import { badRequest, conflict, notFound, referenceNotFound } from '../../shared/errors.js';
import { paginate } from '../../shared/pagination.js';
import { isForeignKeyViolation, isUniqueViolation } from '../../shared/prisma-errors.js';
import { roundRepository } from '../rounds/round.repository.js';
import { requireTournamentAccess } from '../tournaments/tournament.access.js';
import { toGameDto, type GameDto } from './game.dto.js';
import { gameRepository } from './game.repository.js';
import type { CreateGameInput, ListGamesQuery, UpdateGameInput } from './game.schemas.js';

const invalid = (field: string, message: string) =>
  badRequest('Los datos enviados no son válidos', [{ field, message }]);

const roundClosed = () => conflict('ROUND_NOT_EDITABLE', 'La ronda ya terminó y sus partidas no admiten cambios');

// La ronda debe existir, estar activa y no haber terminado
async function requireRoundOpen(tournamentId: string, roundNumber: number) {
  const round = await roundRepository.findByNumber(tournamentId, roundNumber);
  if (!round?.isActive) throw referenceNotFound('roundNumber', 'La ronda no existe o está inactiva');
  if (round.status === 'FINISHED') throw roundClosed();
}

async function requirePlayers(whitePlayerId: string, blackPlayerId: string) {
  const found = new Map((await gameRepository.findPlayers([whitePlayerId, blackPlayerId])).map((p) => [p.id, p.status]));
  const usable = (id: string) => found.has(id) && found.get(id) !== 'INACTIVE';
  if (!usable(whitePlayerId)) throw referenceNotFound('whitePlayerId', 'El jugador de blancas no existe o está inactivo');
  if (!usable(blackPlayerId)) throw referenceNotFound('blackPlayerId', 'El jugador de negras no existe o está inactivo');
}

// Si la partida viene de un emparejamiento, debe ser de la misma ronda y con los mismos jugadores
async function requireMatchingPairing(input: CreateGameInput) {
  if (!input.pairingId) return;
  const pairing = await gameRepository.findPairing(input.pairingId);
  if (!pairing?.isActive) throw referenceNotFound('pairingId', 'El emparejamiento no existe o está inactivo');
  if (pairing.tournamentId !== input.tournamentId || pairing.roundNumber !== input.roundNumber) {
    throw invalid('pairingId', 'El emparejamiento pertenece a otra ronda');
  }
  if (pairing.whitePlayerId !== input.whitePlayerId || pairing.blackPlayerId !== input.blackPlayerId) {
    throw invalid('pairingId', 'Los jugadores no coinciden con los del emparejamiento');
  }
}

async function requireGame(id: string) {
  const game = await gameRepository.findById(id);
  if (!game) throw notFound('La partida no existe');
  return game;
}

export const gameService = {
  async list(query: ListGamesQuery) {
    const { rows, total } = await gameRepository.list(query);
    return paginate(rows.map(toGameDto), query.page, query.limit, total);
  },

  async getById(id: string): Promise<GameDto> {
    return toGameDto(await requireGame(id));
  },

  async create(input: CreateGameInput, userId: string): Promise<GameDto> {
    await requireTournamentAccess(userId, input.tournamentId, 'game:manage');
    if (input.whitePlayerId === input.blackPlayerId) {
      throw invalid('blackPlayerId', 'Un jugador no puede enfrentarse a sí mismo');
    }
    await requireRoundOpen(input.tournamentId, input.roundNumber);
    await requirePlayers(input.whitePlayerId, input.blackPlayerId);
    await requireMatchingPairing(input);

    try {
      return toGameDto(await gameRepository.create(input));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict('GAME_DUPLICATE', 'El emparejamiento ya tiene una partida registrada');
      }
      if (isForeignKeyViolation(error)) throw referenceNotFound('pairingId', 'Alguna de las referencias no existe');
      throw error;
    }
  },

  async update(id: string, input: UpdateGameInput): Promise<GameDto> {
    const current = await requireGame(id);
    await requireRoundOpen(current.tournamentId, current.roundNumber);
    return toGameDto(await gameRepository.update(id, input));
  },

  async deactivate(id: string): Promise<GameDto> {
    const current = await requireGame(id);
    if (!current.isActive) return toGameDto(current);
    if (current.result !== 'PENDING') {
      throw conflict('GAME_HAS_RESULT', 'La partida ya tiene resultado y no se puede dar de baja');
    }
    return toGameDto(await gameRepository.update(id, { isActive: false }));
  },
};
