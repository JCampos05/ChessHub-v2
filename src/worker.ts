import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { closeNotificationQueue } from './lib/queue.js';
import { closeRedis } from './lib/redis.js';
import { startNotificationConsumer } from './modules/notifications/notification.consumer.js';

// Proceso independiente que solo consume la cola de notificaciones (pnpm worker)
await startNotificationConsumer();
logger.info('Trabajador de notificaciones en marcha');

let closing = false;

// Cierre ordenado: deja de consumir, espera el trabajo en curso y cierra Redis y Prisma
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  logger.info({ signal }, 'Cerrando el trabajador');

  const forced = setTimeout(() => {
    logger.error('Cierre forzado por tiempo de espera');
    process.exit(1);
  }, 10_000);
  forced.unref();

  await closeNotificationQueue();
  await closeRedis();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
