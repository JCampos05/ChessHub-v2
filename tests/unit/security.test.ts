import { describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import { AppError } from '../../src/shared/errors.js';
import { hashPassword, verifyPassword } from '../../src/modules/auth/password.js';
import {
  buildRefreshToken,
  generateRefreshSecret,
  hashSecret,
  parseRefreshToken,
  safeEqualHex,
  signAccessToken,
  verifyAccessToken,
} from '../../src/modules/auth/tokens.js';

describe('contraseñas (RF-ACC-03, RNF-01)', () => {
  it('genera un hash bcrypt y lo verifica', async () => {
    const hash = await hashPassword('Clave12345');
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(await verifyPassword('Clave12345', hash)).toBe(true);
    expect(await verifyPassword('otra', hash)).toBe(false);
  });

  it('usa el costo configurado', async () => {
    const hash = await hashPassword('Clave12345');
    expect(bcrypt.getRounds(hash)).toBe(4);
  });
});

describe('tokens (RF-ACC-06)', () => {
  it('firma y verifica un token de acceso', () => {
    const token = signAccessToken({ userId: 'u-1', sessionId: 's-1' });
    expect(verifyAccessToken(token)).toEqual({ userId: 'u-1', sessionId: 's-1' });
  });

  it('rechaza un token manipulado con TOKEN_INVALID', () => {
    const token = signAccessToken({ userId: 'u-1', sessionId: 's-1' });
    const tampered = `${token.slice(0, -3)}abc`;
    expect(() => verifyAccessToken(tampered)).toThrowError(AppError);
    try {
      verifyAccessToken(tampered);
    } catch (error) {
      expect((error as AppError).code).toBe('TOKEN_INVALID');
      expect((error as AppError).statusCode).toBe(401);
    }
  });

  it('el refresh token se separa en sesión y secreto', () => {
    const secret = generateRefreshSecret();
    const token = buildRefreshToken('sesion-1', secret);
    expect(parseRefreshToken(token)).toEqual({ sessionId: 'sesion-1', secret });
  });

  it('un refresh token mal formado devuelve null', () => {
    expect(parseRefreshToken('sin-punto')).toBeNull();
    expect(parseRefreshToken('.secreto')).toBeNull();
    expect(parseRefreshToken('sesion.')).toBeNull();
  });

  it('compara hashes en tiempo constante', () => {
    const a = hashSecret('uno');
    expect(safeEqualHex(a, hashSecret('uno'))).toBe(true);
    expect(safeEqualHex(a, hashSecret('dos'))).toBe(false);
  });
});
