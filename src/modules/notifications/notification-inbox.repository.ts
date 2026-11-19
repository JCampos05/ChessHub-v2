import { prisma } from '../../lib/prisma.js';
import { toSkipTake } from '../../shared/pagination.js';

// Bandeja del usuario: toda consulta lleva user_id, así una notificación ajena nunca se lee ni se modifica
export const notificationInboxRepository = {
  async list(userId: string, page: number, limit: number, read: boolean | undefined) {
    const where = { userId, ...(read === undefined ? {} : { readAt: read ? { not: null } : null }) };
    const [rows, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...toSkipTake(page, limit),
      }),
      prisma.notification.count({ where }),
    ]);
    return { rows, total };
  },

  countUnread(userId: string) {
    return prisma.notification.count({ where: { userId, readAt: null } });
  },

  // Solo toca las que siguen sin leer, por lo que repetir la llamada no cambia la fecha de lectura
  async markRead(userId: string, id: string) {
    await prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
    return prisma.notification.findFirst({ where: { id, userId } });
  },

  async markAllRead(userId: string): Promise<number> {
    const result = await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return result.count;
  },
};
