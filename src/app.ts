import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler } from './middlewares/error-handler.js';
import { notFoundHandler } from './middlewares/not-found.js';
import { globalRateLimiter } from './middlewares/rate-limit.js';
import { requestId } from './middlewares/request-id.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { rootInfo } from './modules/health/health.controller.js';
import { healthRouter } from './modules/health/health.routes.js';
import { playerRouter } from './modules/players/player.routes.js';

// Crea la aplicación sin escuchar en un puerto, para poder usarla con Supertest
export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => String(req.id),
      autoLogging: env.NODE_ENV !== 'test',
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false }));
  app.use(express.json({ limit: '100kb' }));
  app.use(globalRateLimiter);

  app.get('/', rootInfo);
  app.use(healthRouter);
  app.use('/api/v1', healthRouter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/players', playerRouter);
  app.use('/api/v1/jugadores', playerRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
