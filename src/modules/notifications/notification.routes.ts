import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.js';
import { uuidParam, validateQuery } from '../../shared/validate.js';
import { notificationController } from './notification.controller.js';
import { listNotificationsQuerySchema } from './notification.schemas.js';

export const notificationRouter = Router();

notificationRouter.use(authenticate);

// Las rutas fijas van antes de /:id para que no se confundan con un identificador
notificationRouter.get('/', validateQuery(listNotificationsQuerySchema), notificationController.list);
notificationRouter.get('/unread-count', notificationController.unreadCount);
notificationRouter.patch(['/leer-todas', '/read-all'], notificationController.markAllRead);
notificationRouter.patch(['/:id/leida', '/:id/read'], uuidParam('id'), notificationController.markRead);
