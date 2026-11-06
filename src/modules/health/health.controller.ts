import type { Request, Response } from 'express';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';

export async function healthCheck(req: Request, res: Response): Promise<void> {
  const base = { timestamp: new Date().toISOString(), uptime: Math.round(process.uptime()) };
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'ok', ...base, database: 'up' });
  } catch (error) {
    logger.error({ err: error, requestId: req.id }, 'La verificación de salud falló');
    res.status(503).json({ status: 'error', ...base, database: 'down' });
  }
}

export function rootInfo(_req: Request, res: Response): void {
  res.status(200).json({ name: 'ChessHub API', status: 'ok', health: '/api/v1/health' });
}
