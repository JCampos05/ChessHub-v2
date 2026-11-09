import type { Request } from 'express';
import type { ContextResolver, ResourceContext } from '../../middlewares/authorize.js';
import { tournamentRepository } from './tournament.repository.js';

// Contexto de autorización de un torneo: su id y quien lo creó
export async function tournamentContext(tournamentId: string): Promise<ResourceContext | null> {
  const tournament = await tournamentRepository.findById(tournamentId);
  return tournament ? { tournamentId: tournament.id, ownerId: tournament.createdById } : null;
}

export const tournamentFromParam: ContextResolver = (req: Request) => tournamentContext(String(req.params['id']));