import type { Permission } from '../../domain/permissions/catalog.js';
import { conflict, forbidden, referenceNotFound } from '../../shared/errors.js';
import { permissionService } from '../auth/permission.service.js';
import { tournamentRepository } from './tournament.repository.js';
import { isFrozen } from './tournament-status.js';

export async function requireTournamentAccess(userId: string, tournamentId: string, permission: Permission) {
  const tournament = await tournamentRepository.findById(tournamentId);
  if (!tournament?.isActive) throw referenceNotFound('tournamentId', 'El torneo no existe o está inactivo');

  const allowed = await permissionService.can(userId, permission, {
    tournamentId: tournament.id,
    ownerId: tournament.createdById,
  });
  if (!allowed) throw forbidden('OUT_OF_SCOPE', 'No tienes permiso sobre este torneo');

  if (isFrozen(tournament.status)) {
    throw conflict('TOURNAMENT_NOT_EDITABLE', 'El torneo ya terminó o fue cancelado y no admite cambios');
  }
  return tournament;
}
