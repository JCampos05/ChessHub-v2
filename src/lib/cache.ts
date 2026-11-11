import { env } from '../config/env.js';
import { CacheService, MemoryStore } from '../shared/cache.js';
import { getRedis, redisStore, warnRedisFailure } from './redis.js';

const redis = getRedis();

// Respaldo en memoria: se usa sin Redis y cuando Redis falla 
export const memoryStore = new MemoryStore({
  capacity: env.CACHE_LRU_CAPACITY,
  ttlSeconds: env.CACHE_TTL_SECONDS,
});

// Instancia única de la caché de lecturas
export const cache = new CacheService({
  primary: redis ? redisStore(redis) : null,
  fallback: memoryStore,
  ttlSeconds: env.CACHE_TTL_SECONDS,
  onError: warnRedisFailure,
});
