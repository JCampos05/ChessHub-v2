import type { Request, Response } from 'express';
import { playerService } from './player.service.js';

export const playerController = {
  async create(req: Request, res: Response): Promise<void> {
    const player = await playerService.create(req.body, req.auth!.userId);
    res.status(201).json(player);
  },

  async getById(req: Request, res: Response): Promise<void> {
    const player = await playerService.getById(String(req.params['id']), req.auth!.userId);
    res.status(200).json(player);
  },
};
