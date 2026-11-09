import type { Request, Response } from 'express';
import type { ListCategoriesQuery } from './category.schemas.js';
import { categoryService } from './category.service.js';

export const categoryController = {
  async list(_req: Request, res: Response): Promise<void> {
    res.status(200).json(await categoryService.list(res.locals['query'] as ListCategoriesQuery));
  },

  async create(req: Request, res: Response): Promise<void> {
    res.status(201).json(await categoryService.create(req.body, req.auth!.userId));
  },

  async getById(req: Request, res: Response): Promise<void> {
    res.status(200).json(await categoryService.getById(String(req.params['id'])));
  },

  async update(req: Request, res: Response): Promise<void> {
    res.status(200).json(await categoryService.update(String(req.params['id']), req.body));
  },

  async remove(req: Request, res: Response): Promise<void> {
    res.status(200).json(await categoryService.deactivate(String(req.params['id'])));
  },
};
