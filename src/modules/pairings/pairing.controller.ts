import type { Request, Response } from 'express';
import type { ListPairingsQuery } from './pairing.schemas.js';
import { pairingService } from './pairing.service.js';

const id = (req: Request) => String(req.params['id']);

export const pairingController = {
  async list(_req: Request, res: Response): Promise<void> {
    res.status(200).json(await pairingService.list(res.locals['query'] as ListPairingsQuery));
  },

  async create(req: Request, res: Response): Promise<void> {
    res.status(201).json(await pairingService.create(req.body, req.auth!.userId));
  },

  async getById(req: Request, res: Response): Promise<void> {
    res.status(200).json(await pairingService.getById(id(req)));
  },

  async update(req: Request, res: Response): Promise<void> {
    res.status(200).json(await pairingService.update(id(req), req.body));
  },

  async remove(req: Request, res: Response): Promise<void> {
    res.status(200).json(await pairingService.deactivate(id(req)));
  },
};
