import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../../src/config/env.js';

const base = {
  DATABASE_URL: 'postgresql://chesshub:chesshub@localhost:5432/chesshub_dev',
  JWT_SECRET: 'apoco-si-clave-super-hiper-duper-hiper-secreta',
};

describe('parseEnv (C-40)', () => {
  it('aplica valores por omisión cuando solo están las variables obligatorias', () => {
    const env = parseEnv(base);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(env.REFRESH_TTL_DAYS).toBe(7);
    expect(env.BCRYPT_COST).toBe(12);
    expect(env.CORS_ORIGINS).toEqual([]);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.STORAGE_DIR).toBe('./storage');
  });

  it('convierte números y lista de orígenes CORS', () => {
    const env = parseEnv({
      ...base,
      PORT: '4000',
      CORS_ORIGINS: 'http://a.com, http://b.com ,',
    });

    expect(env.PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toEqual(['http://a.com', 'http://b.com']);
  });

  it('Redis es opcional y la caché tiene valores por omisión', () => {
    const env = parseEnv(base);

    expect(env.REDIS_URL).toBeUndefined();
    expect(env.CACHE_TTL_SECONDS).toBe(60);
    expect(env.CACHE_LRU_CAPACITY).toBe(500);
  });

  it('acepta URL de Redis y ajustes de caché', () => {
    const env = parseEnv({
      ...base,
      REDIS_URL: 'redis://localhost:6379',
      CACHE_TTL_SECONDS: '120',
      CACHE_LRU_CAPACITY: '2000',
    });

    expect(env.REDIS_URL).toBe('redis://localhost:6379');
    expect(env.CACHE_TTL_SECONDS).toBe(120);
    expect(env.CACHE_LRU_CAPACITY).toBe(2000);
    expect(parseEnv({ ...base, REDIS_URL: 'rediss://host:6380' }).REDIS_URL).toBe('rediss://host:6380');
  });

  it.each([
    ['REDIS_URL', 'http://localhost:6379'],
    ['REDIS_URL', 'localhost:6379'],
    ['CACHE_TTL_SECONDS', '0'],
    ['CACHE_TTL_SECONDS', '99999'],
    ['CACHE_LRU_CAPACITY', '5'],
  ])('rechaza %s con valor inválido (%s)', (name, value) => {
    expect(() => parseEnv({ ...base, [name]: value })).toThrow(name);
  });

  it('trata las variables vacías como no definidas', () => {
    const env = parseEnv({ ...base, SMTP_USER: '', PORT: '' });

    expect(env.SMTP_USER).toBeUndefined();
    expect(env.PORT).toBe(3000);
  });

  it('falla si falta DATABASE_URL o JWT_SECRET y lista ambos problemas', () => {
    expect(() => parseEnv({})).toThrowError(/DATABASE_URL[\s\S]*JWT_SECRET/);
  });

  it('rechaza un JWT_SECRET de menos de 32 caracteres', () => {
    expect(() => parseEnv({ ...base, JWT_SECRET: 'corto' })).toThrowError(/JWT_SECRET/);
  });

  it('rechaza una DATABASE_URL que no es de PostgreSQL', () => {
    expect(() => parseEnv({ ...base, DATABASE_URL: 'mysql://x/y' })).toThrowError(/DATABASE_URL/);
  });

  it('rechaza un puerto fuera de rango', () => {
    expect(() => parseEnv({ ...base, PORT: '70000' })).toThrowError(/PORT/);
  });

  describe('BCRYPT_COST', () => {
    it('no permite menos de 12 fuera de NODE_ENV=test', () => {
      expect(() => parseEnv({ ...base, NODE_ENV: 'development', BCRYPT_COST: '4' })).toThrowError(
        /BCRYPT_COST/,
      );
    });

    it('permite 4 en NODE_ENV=test', () => {
      expect(parseEnv({ ...base, NODE_ENV: 'test', BCRYPT_COST: '4' }).BCRYPT_COST).toBe(4);
    });
  });

  describe('producción', () => {
    const prod = { ...base, NODE_ENV: 'production', CORS_ORIGINS: 'https://chesshub.mx' };

    it('acepta una configuración correcta', () => {
      expect(parseEnv(prod).NODE_ENV).toBe('production');
    });

    it("rechaza '*' en CORS_ORIGINS", () => {
      expect(() => parseEnv({ ...prod, CORS_ORIGINS: '*' })).toThrowError(/CORS_ORIGINS/);
    });
  });
});
