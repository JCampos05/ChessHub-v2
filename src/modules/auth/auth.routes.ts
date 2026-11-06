import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.js';
import { authRateLimiter } from '../../middlewares/rate-limit.js';
import { validateBody } from '../../shared/validate.js';
import { authController } from './auth.controller.js';
import { loginSchema, refreshSchema, registerSchema } from './auth.schemas.js';

export const authRouter = Router();

authRouter.post('/register', authRateLimiter, validateBody(registerSchema), authController.register);
authRouter.post('/login', authRateLimiter, validateBody(loginSchema), authController.login);
// `/refresh-token` es el nombre que usa el plan de entregas; `/refresh` se conserva como alias.
authRouter.post(['/refresh-token', '/refresh'], authRateLimiter, validateBody(refreshSchema), authController.refresh);
authRouter.get('/me', authenticate, authController.me);
authRouter.post('/logout', authenticate, authController.logout);
