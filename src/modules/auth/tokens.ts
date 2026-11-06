import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { unauthorized } from '../../shared/errors.js';

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
}

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign({ sid: claims.sessionId }, env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: claims.userId,
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || typeof payload.sub !== 'string' || typeof payload['sid'] !== 'string') {
      throw unauthorized('TOKEN_INVALID', 'El token de acceso no es válido');
    }
    return { userId: payload.sub, sessionId: payload['sid'] };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw unauthorized('TOKEN_EXPIRED', 'Tu sesión expiró. Inicia sesión de nuevo');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw unauthorized('TOKEN_INVALID', 'El token de acceso no es válido');
    }
    throw error;
  }
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function generateRefreshSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function buildRefreshToken(sessionId: string, secret: string): string {
  return `${sessionId}.${secret}`;
}

export function parseRefreshToken(token: string): { sessionId: string; secret: string } | null {
  const separator = token.indexOf('.');
  if (separator <= 0 || separator === token.length - 1) return null;
  return { sessionId: token.slice(0, separator), secret: token.slice(separator + 1) };
}

export function safeEqualHex(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'hex');
  const bufferB = Buffer.from(b, 'hex');
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}
