import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { closeNotificationQueue } from './lib/queue.js';
import { closeRedis } from './lib/redis.js';
import { startNotificationConsumer } from './modules/notifications/notification.consumer.js';

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Servidor escuchando');
});

// Consumidor integrado: con WORKER_ENABLED=false otro proceso (pnpm worker) atiende la cola
if (env.WORKER_ENABLED) {
  await startNotificationConsumer();
}

let closing = false;

// Cierre ordenado: deja de aceptar peticiones, termina las activas, detiene el consumidor y cierra Redis y Prisma
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  logger.info({ signal }, 'Cerrando el servidor');

  const forced = setTimeout(() => {
    logger.error('Cierre forzado por tiempo de espera');
    process.exit(1);
  }, 10_000);
  forced.unref();

  server.close(async () => {
    await closeNotificationQueue();
    await closeRedis();
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
