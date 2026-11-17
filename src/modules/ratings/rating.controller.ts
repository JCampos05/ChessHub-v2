import type { Request, Response } from 'express';
import type { ListRatingsQuery } from './rating.schemas.js';
import { ratingService } from './rating.service.js';

const playerId = (req: Request) => String(req.params['id']);

export const ratingController = {
  async list(req: Request, res: Response): Promise<void> {
    res.status(200).json(await ratingService.list(playerId(req), res.locals['query'] as ListRatingsQuery));
  },

  async create(req: Request, res: Response): Promise<void> {
    res.status(201).json(await ratingService.create(playerId(req), req.body, req.auth!.userId));
  },
};
