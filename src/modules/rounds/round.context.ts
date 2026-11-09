import type { Request } from 'express';
import type { ContextResolver } from '../../middlewares/authorize.js';
import { tournamentContext } from '../tournaments/tournament.context.js';
import { roundRepository } from './round.repository.js';

// Contexto de autorización de una ronda: el del torneo al que pertenece
export const roundFromParam: ContextResolver = async (req: Request) => {
  const round = await roundRepository.findById(String(req.params['id']));
  return round ? tournamentContext(round.tournamentId) : null;
};
