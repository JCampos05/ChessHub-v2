import type { Request } from 'express';
import type { ContextResolver } from '../../middlewares/authorize.js';
import { tournamentContext } from '../tournaments/tournament.context.js';
import { gameRepository } from './game.repository.js';

export const gameFromParam: ContextResolver = async (req: Request) => {
  const game = await gameRepository.findById(String(req.params['id']));
  return game ? tournamentContext(game.tournamentId) : null;
};
