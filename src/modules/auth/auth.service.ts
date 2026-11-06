import { env } from '../../config/env.js';
import { conflict, forbidden, tooManyRequests, unauthorized } from '../../shared/errors.js';
import type { RequestContext } from '../../shared/http.js';
import { toUserDto, type UserDto } from '../users/user.dto.js';
import { userRepository } from '../users/user.repository.js';
import { logAccess } from './access-log.service.js';
import type { LoginInput, RegisterInput } from './auth.schemas.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from './password.js';
import { sessionRepository } from './session.repository.js';
import {
  buildRefreshToken,
  generateRefreshSecret,
  hashSecret,
  parseRefreshToken,
  safeEqualHex,
  signAccessToken,
} from './tokens.js';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const ABSOLUTE_SESSION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuthTokens {
  token: string;
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export interface LoginResult extends AuthTokens {
  user: UserDto;
}

const INVALID_REFRESH = () => unauthorized('REFRESH_TOKEN_INVALID', 'El refresh token no es válido');

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function buildTokens(userId: string, sessionId: string, secret: string): AuthTokens {
  const accessToken = signAccessToken({ userId, sessionId });
  return {
    token: accessToken,
    accessToken,
    refreshToken: buildRefreshToken(sessionId, secret),
    tokenType: 'Bearer',
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
  };
}

export const authService = {
  async register(input: RegisterInput, context: RequestContext): Promise<UserDto> {
    const passwordHash = await hashPassword(input.password);
    try {
      const user = await userRepository.create({
        email: input.email,
        passwordHash,
        fullName: input.fullName,
      });
      await logAccess({ event: 'REGISTER', userId: user.id, emailAttempted: user.email }, context);
      return toUserDto(user);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict('EMAIL_ALREADY_REGISTERED', 'Ya existe una cuenta con ese correo electrónico');
      }
      throw error;
    }
  },

  async login(input: LoginInput, context: RequestContext): Promise<LoginResult> {
    const user = await userRepository.findByEmail(input.email);

    if (!user) {
      await burnPasswordCheck(input.password);
      await logAccess({ event: 'LOGIN_FAILED', emailAttempted: input.email }, context);
      throw unauthorized('INVALID_CREDENTIALS', 'Correo o contraseña incorrectos');
    }

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      const retryAfter = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000);
      await logAccess({ event: 'ACCOUNT_LOCKED', userId: user.id, emailAttempted: input.email }, context);
      throw tooManyRequests('ACCOUNT_LOCKED', 'Cuenta bloqueada temporalmente por intentos fallidos', retryAfter);
    }

    const valid = await verifyPassword(input.password, user.passwordHash);
    if (!valid) {
      await logAccess({ event: 'LOGIN_FAILED', userId: user.id, emailAttempted: input.email }, context);
      const attempts = await userRepository.registerFailedAttempt(user.id);
      if (attempts >= MAX_FAILED_ATTEMPTS) {
        await userRepository.lock(user.id, new Date(Date.now() + LOCK_MINUTES * 60 * 1000));
        await logAccess({ event: 'ACCOUNT_LOCKED', userId: user.id, emailAttempted: input.email }, context);
        throw tooManyRequests(
          'ACCOUNT_LOCKED',
          'Cuenta bloqueada temporalmente por intentos fallidos',
          LOCK_MINUTES * 60,
        );
      }
      throw unauthorized('INVALID_CREDENTIALS', 'Correo o contraseña incorrectos');
    }

    if (!user.isActive) {
      await logAccess({ event: 'LOGIN_FAILED', userId: user.id, emailAttempted: input.email }, context);
      throw forbidden('ACCOUNT_DISABLED', 'La cuenta está desactivada');
    }

    await userRepository.clearFailures(user.id);

    const secret = generateRefreshSecret();
    const session = await sessionRepository.create({
      userId: user.id,
      refreshTokenHash: hashSecret(secret),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      expiresAt: new Date(now.getTime() + env.REFRESH_TTL_DAYS * DAY_MS),
      absoluteExpiresAt: new Date(now.getTime() + ABSOLUTE_SESSION_DAYS * DAY_MS),
    });

    await logAccess({ event: 'LOGIN_SUCCESS', userId: user.id, emailAttempted: input.email }, context);

    const roles = await userRepository.findRoles(user.id);
    return { ...buildTokens(user.id, session.id, secret), user: toUserDto(user, roles) };
  },

  async me(userId: string): Promise<UserDto> {
    const user = await userRepository.findById(userId);
    if (!user) throw unauthorized('SESSION_NOT_FOUND', 'La sesión ya no es válida');
    const roles = await userRepository.findRoles(user.id);
    return toUserDto(user, roles);
  },

  async refresh(refreshToken: string, context: RequestContext): Promise<AuthTokens> {
    const parsed = parseRefreshToken(refreshToken);
    if (!parsed || !UUID_PATTERN.test(parsed.sessionId)) throw INVALID_REFRESH();

    const session = await sessionRepository.findById(parsed.sessionId);
    if (!session || session.revokedAt) throw INVALID_REFRESH();

    const now = new Date();
    if (session.expiresAt <= now || session.absoluteExpiresAt <= now) {
      throw unauthorized('SESSION_EXPIRED', 'Tu sesión expiró. Inicia sesión de nuevo');
    }

    const presentedHash = hashSecret(parsed.secret);
    const reused = !safeEqualHex(presentedHash, session.refreshTokenHash);
    if (reused) {
      await sessionRepository.revoke(session.id, 'REFRESH_REUSE');
      await logAccess({ event: 'REFRESH_REUSE', userId: session.userId }, context);
      throw INVALID_REFRESH();
    }

    const user = await userRepository.findById(session.userId);
    if (!user || !user.isActive) {
      await sessionRepository.revoke(session.id, 'USER_INACTIVE');
      throw INVALID_REFRESH();
    }

    const newSecret = generateRefreshSecret();
    const slidingExpiry = new Date(now.getTime() + env.REFRESH_TTL_DAYS * DAY_MS);
    const expiresAt = slidingExpiry < session.absoluteExpiresAt ? slidingExpiry : session.absoluteExpiresAt;

    const rotated = await sessionRepository.rotate(session.id, session.refreshTokenHash, hashSecret(newSecret), expiresAt);
    if (rotated === 0) {
      await sessionRepository.revoke(session.id, 'REFRESH_REUSE');
      await logAccess({ event: 'REFRESH_REUSE', userId: session.userId }, context);
      throw INVALID_REFRESH();
    }

    await logAccess({ event: 'REFRESH', userId: session.userId }, context);
    return buildTokens(user.id, session.id, newSecret);
  },

  async logout(userId: string, sessionId: string, context: RequestContext): Promise<void> {
    await sessionRepository.revoke(sessionId, 'LOGOUT');
    await logAccess({ event: 'LOGOUT', userId }, context);
  },
};
