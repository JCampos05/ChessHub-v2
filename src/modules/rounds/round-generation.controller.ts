import type { Request, Response } from 'express';
import { roundGenerationService } from './round-generation.service.js';

export const roundGenerationController = {
  async generate(req: Request, res: Response): Promise<void> {
    res.status(201).json(await roundGenerationService.generate(String(req.params['id'])));
  },
};
