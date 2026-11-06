import type { NextFunction, Request, Response } from 'express';
import { sessionRepository } from '../modules/auth/session.repository.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';
import { userRepository } from '../modules/users/user.repository.js';
import { forbidden, unauthorized } from '../shared/errors.js';

export interface AuthContext {
  userId: string;
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.get('authorization');
    if (!header) throw unauthorized('TOKEN_MISSING', 'Falta el token de acceso');

    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw unauthorized('TOKEN_INVALID', 'El token de acceso no es válido');
    }

    const claims = verifyAccessToken(token);
    if (!UUID_PATTERN.test(claims.sessionId) || !UUID_PATTERN.test(claims.userId)) {
      throw unauthorized('TOKEN_INVALID', 'El token de acceso no es válido');
    }

    const session = await sessionRepository.findById(claims.sessionId);
    if (!session || session.userId !== claims.userId) {
      throw unauthorized('SESSION_NOT_FOUND', 'La sesión ya no existe. Inicia sesión de nuevo');
    }

    const now = new Date();
    if (session.revokedAt) {
      throw unauthorized('SESSION_REVOKED', 'Tu sesión fue cerrada. Inicia sesión de nuevo');
    }
    if (session.expiresAt <= now || session.absoluteExpiresAt <= now) {
      throw unauthorized('SESSION_EXPIRED', 'Tu sesión expiró. Inicia sesión de nuevo');
    }

    const user = await userRepository.findById(claims.userId);
    if (!user) throw unauthorized('SESSION_NOT_FOUND', 'La sesión ya no existe. Inicia sesión de nuevo');
    if (!user.isActive) throw forbidden('ACCOUNT_DISABLED', 'La cuenta está desactivada');

    req.auth = { userId: claims.userId, sessionId: claims.sessionId };
    next();
  } catch (error) {
    next(error);
  }
}
