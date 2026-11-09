import { badRequest, conflict, notFound, referenceNotFound } from '../../shared/errors.js';
import { paginate } from '../../shared/pagination.js';
import { isForeignKeyViolation, isUniqueViolation } from '../../shared/prisma-errors.js';
import { roundRepository } from '../rounds/round.repository.js';
import { requireTournamentAccess } from '../tournaments/tournament.access.js';
import { toPairingDto, type PairingDto } from './pairing.dto.js';
import { pairingRepository, type PairingSlot, type SlotConflict } from './pairing.repository.js';
import type { CreatePairingInput, ListPairingsQuery, UpdatePairingInput } from './pairing.schemas.js';

const conflictError = (reason: SlotConflict) =>
  reason === 'BOARD_TAKEN'
    ? conflict('BOARD_TAKEN', 'Esa mesa ya está asignada en la ronda (puede estar inactiva)')
    : conflict('PLAYER_ALREADY_PAIRED', 'Uno de los jugadores ya tiene mesa en esta ronda');

const roundNotEditable = () =>
  conflict('ROUND_NOT_EDITABLE', 'La ronda ya se inició o terminó y sus emparejamientos no admiten cambios');

async function requireRoundOpen(tournamentId: string, roundNumber: number) {
  const round = await roundRepository.findByNumber(tournamentId, roundNumber);
  if (!round?.isActive) throw referenceNotFound('roundNumber', 'La ronda no existe o está inactiva');
  if (round.status !== 'PENDING') throw roundNotEditable();
}

// Los jugadores deben existir y no estar dados de baja
async function requirePlayers(slot: PairingSlot) {
  const ids = slot.blackPlayerId ? [slot.whitePlayerId, slot.blackPlayerId] : [slot.whitePlayerId];
  const found = new Map((await pairingRepository.findPlayers(ids)).map((p) => [p.id, p.status]));
  const usable = (id: string) => found.has(id) && found.get(id) !== 'INACTIVE';
  if (!usable(slot.whitePlayerId)) {
    throw referenceNotFound('whitePlayerId', 'El jugador de blancas no existe o está inactivo');
  }
  if (slot.blackPlayerId && !usable(slot.blackPlayerId)) {
    throw referenceNotFound('blackPlayerId', 'El jugador de negras no existe o está inactivo');
  }
}

function requireDistinctPlayers(slot: PairingSlot) {
  if (slot.blackPlayerId !== null && slot.blackPlayerId === slot.whitePlayerId) {
    throw badRequest('Los datos enviados no son válidos', [
      { field: 'blackPlayerId', message: 'Un jugador no puede enfrentarse a sí mismo' },
    ]);
  }
}

async function persist(slot: PairingSlot, excludeId: string | null): Promise<PairingDto> {
  try {
    const result = await pairingRepository.writeInRound(slot, excludeId);
    if (!result.ok) throw conflictError(result.conflict);
    return toPairingDto(result.pairing);
  } catch (error) {
    // Red de seguridad: las restricciones únicas de la base ganan si dos escrituras compiten
    if (isUniqueViolation(error)) throw conflictError('BOARD_TAKEN');
    if (isForeignKeyViolation(error)) throw referenceNotFound('whitePlayerId', 'Alguna de las referencias no existe');
    throw error;
  }
}

async function requirePairing(id: string) {
  const pairing = await pairingRepository.findById(id);
  if (!pairing) throw notFound('El emparejamiento no existe');
  return pairing;
}

export const pairingService = {
  async list(query: ListPairingsQuery) {
    const { rows, total } = await pairingRepository.list(query);
    return paginate(rows.map(toPairingDto), query.page, query.limit, total);
  },

  async getById(id: string): Promise<PairingDto> {
    return toPairingDto(await requirePairing(id));
  },

  async create(input: CreatePairingInput, userId: string): Promise<PairingDto> {
    await requireTournamentAccess(userId, input.tournamentId, 'round:manage');
    requireDistinctPlayers(input);
    await requireRoundOpen(input.tournamentId, input.roundNumber);
    await requirePlayers(input);
    return persist(input, null);
  },

  async update(id: string, input: UpdatePairingInput): Promise<PairingDto> {
    const current = await requirePairing(id);
    await requireRoundOpen(current.tournamentId, current.roundNumber);

    const slot: PairingSlot = {
      tournamentId: current.tournamentId,
      roundNumber: current.roundNumber,
      board: input.board ?? current.board,
      whitePlayerId: input.whitePlayerId ?? current.whitePlayerId,
      blackPlayerId: input.blackPlayerId === undefined ? current.blackPlayerId : input.blackPlayerId,
    };
    requireDistinctPlayers(slot);
    await requirePlayers(slot);
    return persist(slot, id);
  },

  async deactivate(id: string): Promise<PairingDto> {
    const current = await requirePairing(id);
    if (!current.isActive) return toPairingDto(current);
    await requireRoundOpen(current.tournamentId, current.roundNumber);
    return toPairingDto(await pairingRepository.setActive(id, false));
  },
};
