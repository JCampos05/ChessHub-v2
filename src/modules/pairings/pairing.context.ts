import type { Request } from 'express';
import type { ContextResolver } from '../../middlewares/authorize.js';
import { tournamentContext } from '../tournaments/tournament.context.js';
import { pairingRepository } from './pairing.repository.js';

// Contexto de autorización de un emparejamiento: el de su torneo
export const pairingFromParam: ContextResolver = async (req: Request) => {
  const pairing = await pairingRepository.findById(String(req.params['id']));
  return pairing ? tournamentContext(pairing.tournamentId) : null;
};
