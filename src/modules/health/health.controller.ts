import type { Request, Response } from 'express';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { redisHealth } from '../../lib/redis.js';

// La base de datos decide el estado del servicio. Redis solo informa: sin él la caché usa la memoria
// del proceso, así que su caída degrada el rendimiento pero no la disponibilidad
export async function healthCheck(req: Request, res: Response): Promise<void> {
  const base = { timestamp: new Date().toISOString(), uptime: Math.round(process.uptime()) };
  const redis = await redisHealth.check();
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'ok', ...base, database: 'up', redis });
  } catch (error) {
    logger.error({ err: error, requestId: req.id }, 'La verificación de salud falló');
    res.status(503).json({ status: 'error', ...base, database: 'down', redis });
  }
}

export function rootInfo(_req: Request, res: Response): void {
  res.status(200).json({ name: 'ChessHub API', status: 'ok', health: '/api/v1/health' });
}
