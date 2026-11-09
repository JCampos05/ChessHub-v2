import type { Request, Response } from 'express';
import type { ListGamesQuery } from './game.schemas.js';
import { gameService } from './game.service.js';

const id = (req: Request) => String(req.params['id']);

export const gameController = {
  async list(_req: Request, res: Response): Promise<void> {
    res.status(200).json(await gameService.list(res.locals['query'] as ListGamesQuery));
  },

  async create(req: Request, res: Response): Promise<void> {
    res.status(201).json(await gameService.create(req.body, req.auth!.userId));
  },

  async getById(req: Request, res: Response): Promise<void> {
    res.status(200).json(await gameService.getById(id(req)));
  },

  async update(req: Request, res: Response): Promise<void> {
    res.status(200).json(await gameService.update(id(req), req.body));
  },

  async remove(req: Request, res: Response): Promise<void> {
    res.status(200).json(await gameService.deactivate(id(req)));
  },
};
