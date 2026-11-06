import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Servidor escuchando');
});

let closing = false;

// Cierre ordenado: deja de aceptar peticiones, termina las activas y cierra Prisma
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
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
