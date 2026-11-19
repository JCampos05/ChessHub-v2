import type { Request, RequestHandler, Response } from 'express';
import type { ChangeStateInput, NamedStateInput, StateHistoryQuery } from './tournament-state.schemas.js';
import { tournamentStateService } from './tournament-state.service.js';
import type { TournamentStatusCode } from '../tournament-status.js';

const id = (req: Request) => String(req.params['id']);

export const tournamentStateController = {
  // PATCH /torneos/:id/estado: el destino viene en el cuerpo
  async change(req: Request, res: Response): Promise<void> {
    const { to, reason } = req.body as ChangeStateInput;
    res.status(200).json(await tournamentStateService.changeState(id(req), to, reason, req.auth!.userId));
  },

  // Rutas por nombre: el destino lo fija la ruta; solo la cancelación admite motivo
  toState(to: TournamentStatusCode): RequestHandler {
    return async (req: Request, res: Response): Promise<void> => {
      const { reason } = req.body as NamedStateInput;
      const motive = to === 'CANCELLED' ? reason : undefined;
      res.status(200).json(await tournamentStateService.changeState(id(req), to, motive, req.auth!.userId));
    };
  },

  async history(req: Request, res: Response): Promise<void> {
    res.status(200).json(await tournamentStateService.history(id(req), res.locals['query'] as StateHistoryQuery));
  },
};
