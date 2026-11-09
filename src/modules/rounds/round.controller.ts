import type { Request, Response } from 'express';
import type { ListRoundsQuery } from './round.schemas.js';
import { roundService } from './round.service.js';

const id = (req: Request) => String(req.params['id']);

export const roundController = {
  async list(_req: Request, res: Response): Promise<void> {
    res.status(200).json(await roundService.list(res.locals['query'] as ListRoundsQuery));
  },

  async create(req: Request, res: Response): Promise<void> {
    res.status(201).json(await roundService.create(req.body, req.auth!.userId));
  },

  async getById(req: Request, res: Response): Promise<void> {
    res.status(200).json(await roundService.getById(id(req)));
  },

  async update(req: Request, res: Response): Promise<void> {
    res.status(200).json(await roundService.update(id(req), req.body));
  },

  async remove(req: Request, res: Response): Promise<void> {
    res.status(200).json(await roundService.deactivate(id(req)));
  },
};
