import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';
import { AppError } from '../shared/errors.js';

interface LimiterOptions {
  windowMs: number;
  limit: number;
  /** Las pruebas de integración lo desactivan; la prueba del límite lo deja activo. */
  skipInTest?: boolean;
}

export function createRateLimiter({ windowMs, limit, skipInTest = true }: LimiterOptions): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => skipInTest && env.NODE_ENV === 'test',
    handler: (_req, res, next) => {
      const retryAfter = Number(res.getHeader('Retry-After')) || Math.ceil(windowMs / 1000);
      next(
        new AppError(429, 'TOO_MANY_REQUESTS', 'Demasiadas peticiones. Intenta de nuevo en unos momentos', undefined, {
          'Retry-After': String(retryAfter),
        }),
      );
    },
  });
}

export const authRateLimiter = createRateLimiter({ windowMs: 60_000, limit: 10 });

export const globalRateLimiter = createRateLimiter({ windowMs: 60_000, limit: 120 });