import type { Request, Response } from 'express';
import type { ListRegistrationsQuery } from './registration.schemas.js';
import { registrationService } from './registration.service.js';

const tournamentId = (req: Request) => String(req.params['id']);
const registrationId = (req: Request) => String(req.params['registrationId']);

export const registrationController = {
  async create(req: Request, res: Response): Promise<void> {
    res.status(201).json(await registrationService.create(tournamentId(req), req.body, req.auth!.userId));
  },

  async list(req: Request, res: Response): Promise<void> {
    res
      .status(200)
      .json(await registrationService.list(tournamentId(req), res.locals['query'] as ListRegistrationsQuery));
  },

  async cancel(req: Request, res: Response): Promise<void> {
    res
      .status(200)
      .json(await registrationService.cancel(tournamentId(req), registrationId(req), req.auth!.userId));
  },

  async confirmPayment(req: Request, res: Response): Promise<void> {
    res
      .status(200)
      .json(await registrationService.confirmPayment(tournamentId(req), registrationId(req), req.auth!.userId));
  },
};
