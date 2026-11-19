import type { Request, Response } from 'express';
import type { ListNotificationsQuery } from './notification.schemas.js';
import { notificationService } from './notification.service.js';

export const notificationController = {
  async list(req: Request, res: Response): Promise<void> {
    res.status(200).json(await notificationService.list(req.auth!.userId, res.locals['query'] as ListNotificationsQuery));
  },

  async unreadCount(req: Request, res: Response): Promise<void> {
    res.status(200).json(await notificationService.unreadCount(req.auth!.userId));
  },

  async markRead(req: Request, res: Response): Promise<void> {
    res.status(200).json(await notificationService.markRead(req.auth!.userId, String(req.params['id'])));
  },

  async markAllRead(req: Request, res: Response): Promise<void> {
    res.status(200).json(await notificationService.markAllRead(req.auth!.userId));
  },
};
