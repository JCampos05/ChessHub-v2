import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import type { KeyValueStore } from '../shared/cache.js';
import { logger } from './logger.js';

// Cliente único (singleton). Sin REDIS_URL no se crea y la aplicación funciona solo con la caché en memoria.
let client: Redis | null | undefined;

const WARN_INTERVAL_MS = 30_000;
let lastWarnAt = 0;

// Avisa de un fallo de Redis como máximo cada 30 s para no inundar los registros
export function warnRedisFailure(error: unknown): void {
  const now = Date.now();
  if (now - lastWarnAt < WARN_INTERVAL_MS) return;
  lastWarnAt = now;
  logger.warn({ err: error }, 'Redis no responde; se usa la caché en memoria');
}

export function getRedis(): Redis | null {
  if (client !== undefined) return client;
  if (!env.REDIS_URL) {
    client = null;
    return client;
  }
  client = new Redis(env.REDIS_URL, {
    // Con Redis caído las órdenes fallan de inmediato en lugar de encolarse y colgar la petición
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 1_000,
    retryStrategy: (attempt) => Math.min(attempt * 200, 2_000),
  });
  client.on('error', warnRedisFailure);
  return client;
}

export function redisStore(redis: Redis): KeyValueStore {
  return {
    async get(key) {
      return redis.get(key);
    },
    async set(key, value, ttlSeconds) {
      await redis.set(key, value, 'EX', ttlSeconds);
    },
    async incr(key) {
      return redis.incr(key);
    },
  };
}

export type RedisState = 'up' | 'down' | 'disabled';

// Objeto (no función suelta) para poder sustituirlo en las pruebas de salud
export const redisHealth = {
  async check(): Promise<RedisState> {
    const redis = getRedis();
    if (!redis) return 'disabled';
    try {
      const reply = await Promise.race([
        redis.ping(),
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('ping vencido')), 500).unref()),
      ]);
      return reply === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    }
  },
};

export async function closeRedis(): Promise<void> {
  if (!client) return;
  const current = client;
  client = undefined;
  try {
    await current.quit();
  } catch {
    current.disconnect();
  }
}
