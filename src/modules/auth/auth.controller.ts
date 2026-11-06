import type { Request, Response } from 'express';
import { getRequestContext } from '../../shared/http.js';
import { authService } from './auth.service.js';

export const authController = {
  async register(req: Request, res: Response): Promise<void> {
    const user = await authService.register(req.body, getRequestContext(req));
    res.status(201).json(user);
  },

  async login(req: Request, res: Response): Promise<void> {
    const result = await authService.login(req.body, getRequestContext(req));
    res.status(200).json(result);
  },

  async me(req: Request, res: Response): Promise<void> {
    const user = await authService.me(req.auth!.userId);
    res.status(200).json(user);
  },

  async refresh(req: Request, res: Response): Promise<void> {
    const tokens = await authService.refresh(req.body.refreshToken, getRequestContext(req));
    res.status(200).json(tokens);
  },

  async logout(req: Request, res: Response): Promise<void> {
    await authService.logout(req.auth!.userId, req.auth!.sessionId, getRequestContext(req));
    res.status(200).json({ message: 'Sesión cerrada' });
  },
};
