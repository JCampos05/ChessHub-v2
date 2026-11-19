import { notFound } from '../../shared/errors.js';
import { paginate } from '../../shared/pagination.js';
import { notificationInboxRepository as repo } from './notification-inbox.repository.js';
import { toNotificationDto, type NotificationDto } from './notification.dto.js';
import type { ListNotificationsQuery } from './notification.schemas.js';

export const notificationService = {
  async list(userId: string, query: ListNotificationsQuery) {
    const { rows, total } = await repo.list(userId, query.page, query.limit, query.leida);
    return paginate(rows.map(toNotificationDto), query.page, query.limit, total);
  },

  async unreadCount(userId: string): Promise<{ count: number }> {
    return { count: await repo.countUnread(userId) };
  },

  // Una notificación ajena responde igual que una inexistente: no se revela que existe
  async markRead(userId: string, id: string): Promise<NotificationDto> {
    const row = await repo.markRead(userId, id);
    if (!row) throw notFound('La notificación no existe');
    return toNotificationDto(row);
  },

  async markAllRead(userId: string): Promise<{ updated: number }> {
    return { updated: await repo.markAllRead(userId) };
  },
};
