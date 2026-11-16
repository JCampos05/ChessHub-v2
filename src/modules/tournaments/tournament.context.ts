import type { Request, RequestHandler } from 'express';
import type { Permission } from '../../domain/permissions/catalog.js';
import { authorize, type ContextResolver, type ResourceContext } from '../../middlewares/authorize.js';
import { uuidParam } from '../../shared/validate.js';
import { tournamentRepository } from './tournament.repository.js';

// Contexto de autorización de un torneo: su id y quien lo creó
export async function tournamentContext(tournamentId: string): Promise<ResourceContext | null> {
  const tournament = await tournamentRepository.findById(tournamentId);
  return tournament ? { tournamentId: tournament.id, ownerId: tournament.createdById } : null;
}

export const tournamentFromParam: ContextResolver = (req: Request) => tournamentContext(String(req.params['id']));

// Permiso sobre el torneo de :id. Primero el permiso sin recurso (sin él, 403 aunque el id sea inválido);
// después el id (404 si es inválido o no existe) y el ámbito del torneo (403 OUT_OF_SCOPE)
export const authorizeOnTournament = (permission: Permission): RequestHandler[] => [
  authorize(permission),
  uuidParam('id'),
  authorize(permission, tournamentFromParam),
];
