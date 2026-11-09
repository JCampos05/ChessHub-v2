import type { Request, Response } from 'express';
import type { ListPlayersQuery } from './player.schemas.js';
import { playerService } from './player.service.js';

const id = (req: Request) => String(req.params['id']);

export const playerController = {
  async create(req: Request, res: Response): Promise<void> {
    res.status(201).json(await playerService.create(req.body, req.auth!.userId));
  },

  async list(req: Request, res: Response): Promise<void> {
    res.status(200).json(await playerService.list(res.locals['query'] as ListPlayersQuery, req.auth!.userId));
  },

  async getById(req: Request, res: Response): Promise<void> {
    res.status(200).json(await playerService.getById(id(req), req.auth!.userId));
  },

  async update(req: Request, res: Response): Promise<void> {
    res.status(200).json(await playerService.update(id(req), req.body, req.auth!.userId));
  },

  async remove(req: Request, res: Response): Promise<void> {
    res.status(200).json(await playerService.deactivate(id(req)));
  },
};
