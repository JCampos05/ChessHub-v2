import { createHash } from 'node:crypto';
import { stableStringify } from '../domain/cache/key.js';
import { LruCache } from '../domain/cache/lru.js';

// Almacén de pares clave-texto. Lo implementan Redis (lib/redis.ts) y la memoria del proceso.
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  incr(key: string): Promise<number>;
}

export interface MemoryStoreOptions {
  capacity: number;
  ttlSeconds: number;
  now?: () => number;
}

// Respaldo en memoria: LRU para los valores y contadores simples para las versiones
export class MemoryStore implements KeyValueStore {
  private readonly values: LruCache<string>;
  private readonly counters = new Map<string, number>();

  constructor(options: MemoryStoreOptions) {
    this.values = new LruCache<string>({
      capacity: options.capacity,
      ttlMs: options.ttlSeconds * 1000,
      ...(options.now ? { now: options.now } : {}),
    });
  }

  get(key: string): Promise<string | null> {
    // Igual que en Redis, un contador creado con incr se lee con get
    const counter = this.counters.get(key);
    if (counter !== undefined) return Promise.resolve(String(counter));
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.values.set(key, value, ttlSeconds * 1000);
    return Promise.resolve();
  }

  incr(key: string): Promise<number> {
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return Promise.resolve(next);
  }

  clear(): void {
    this.values.clear();
    this.counters.clear();
  }
}

export interface CacheServiceOptions {
  // Almacén principal (Redis). null cuando no hay Redis configurado.
  primary: KeyValueStore | null;
  // Respaldo en memoria: se usa sin Redis o cuando Redis falla.
  fallback: KeyValueStore;
  ttlSeconds: number;
  // Aviso de un fallo del almacén principal; la caché nunca propaga errores.
  onError?: (error: unknown) => void;
}

const hash = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 32);

export class CacheService {
  private readonly localVersions = new Map<string, number>();

  constructor(private readonly options: CacheServiceOptions) {}

  async getOrLoad<T>(resource: string, query: unknown, loader: () => Promise<T>): Promise<T> {
    const key = await this.keyFor(resource, query);

    const cached = await this.read(key);
    if (cached !== null) {
      try {
        return JSON.parse(cached) as T;
      } catch {
        // Un valor ilegible se trata como ausente y se reemplaza
      }
    }

    const value = await loader();
    await this.write(key, JSON.stringify(value));
    return value;
  }

  // Invalida todo lo cacheado de un recurso. Se llama después de confirmar una escritura.
  async bump(resource: string): Promise<void> {
    this.localVersions.set(resource, (this.localVersions.get(resource) ?? 0) + 1);
    if (!this.options.primary) return;
    try {
      await this.options.primary.incr(this.versionKey(resource));
    } catch (error) {
      this.report(error);
    }
  }

  private versionKey(resource: string): string {
    return `cache:ver:${resource}`;
  }

  private async keyFor(resource: string, query: unknown): Promise<string> {
    let remote = '0';
    if (this.options.primary) {
      try {
        remote = (await this.options.primary.get(this.versionKey(resource))) ?? '0';
      } catch (error) {
        this.report(error);
        remote = 'x';
      }
    }
    const local = this.localVersions.get(resource) ?? 0;
    return `cache:${resource}:${remote}.${local}:${hash(stableStringify(query))}`;
  }

  private async read(key: string): Promise<string | null> {
    if (this.options.primary) {
      try {
        return await this.options.primary.get(key);
      } catch (error) {
        this.report(error);
      }
    }
    return this.options.fallback.get(key);
  }

  private async write(key: string, value: string): Promise<void> {
    if (this.options.primary) {
      try {
        await this.options.primary.set(key, value, this.options.ttlSeconds);
        return;
      } catch (error) {
        this.report(error);
      }
    }
    await this.options.fallback.set(key, value, this.options.ttlSeconds);
  }

  private report(error: unknown): void {
    try {
      this.options.onError?.(error);
    } catch {
      // El aviso nunca debe romper la petición
    }
  }
}
