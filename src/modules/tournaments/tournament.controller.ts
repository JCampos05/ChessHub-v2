import type { Request, Response } from 'express';
import type { ListTournamentsQuery } from './tournament.schemas.js';
import { tournamentService } from './tournament.service.js';

const id = (req: Request) => String(req.params['id']);

export const tournamentController = {
  async list(_req: Request, res: Response): Promise<void> {
    res.status(200).json(await tournamentService.list(res.locals['query'] as ListTournamentsQuery));
  },

  async create(req: Request, res: Response): Promise<void> {
    res.status(201).json(await tournamentService.create(req.body, req.auth!.userId));
  },

  async getById(req: Request, res: Response): Promise<void> {
    res.status(200).json(await tournamentService.getById(id(req)));
  },

  async update(req: Request, res: Response): Promise<void> {
    res.status(200).json(await tournamentService.update(id(req), req.body));
  },

  async remove(req: Request, res: Response): Promise<void> {
    res.status(200).json(await tournamentService.deactivate(id(req)));
  },

  async listCategories(req: Request, res: Response): Promise<void> {
    res.status(200).json({ data: await tournamentService.listCategories(id(req)) });
  },

  async linkCategory(req: Request, res: Response): Promise<void> {
    res.status(200).json(await tournamentService.linkCategory(id(req), String(req.params['categoryId'])));
  },

  async unlinkCategory(req: Request, res: Response): Promise<void> {
    res.status(200).json(await tournamentService.unlinkCategory(id(req), String(req.params['categoryId'])));
  },
};
