import { describe, expect, it, vi } from 'vitest';
import { stableStringify } from '../../src/domain/cache/key.js';
import { CacheService, MemoryStore, type KeyValueStore } from '../../src/shared/cache.js';

const memory = () => new MemoryStore({ capacity: 100, ttlSeconds: 60 });

// Almacén que falla en todas las operaciones, como un Redis caído
const broken = (): KeyValueStore => ({
  get: () => Promise.reject(new Error('redis caído')),
  set: () => Promise.reject(new Error('redis caído')),
  incr: () => Promise.reject(new Error('redis caído')),
});

function service(primary: KeyValueStore | null = null, onError?: (error: unknown) => void) {
  const fallback = memory();
  const cache = new CacheService({ primary, fallback, ttlSeconds: 60, ...(onError ? { onError } : {}) });
  return { cache, fallback };
}

describe('stableStringify', () => {
  it('no depende del orden de las propiedades, ni siquiera anidadas', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it('omite propiedades indefinidas y distingue valores distintos', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it('serializa valores sin contenido', () => {
    expect(stableStringify(undefined)).toBe('null');
    expect(stableStringify(null)).toBe('null');
  });
});

describe('CacheService (RF13, RNF04)', () => {
  it('ejecuta el cargador una vez y sirve el resto desde la caché', async () => {
    const { cache } = service();
    const loader = vi.fn(async () => ({ total: 3 }));

    const first = await cache.getOrLoad('players', { page: 1 }, loader);
    const second = await cache.getOrLoad('players', { page: 1 }, loader);

    expect(first).toEqual({ total: 3 });
    expect(second).toEqual({ total: 3 });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('el orden de los parámetros de la consulta no cambia la clave', async () => {
    const { cache } = service();
    const loader = vi.fn(async () => 'ok');
    await cache.getOrLoad('players', { page: 1, limit: 10 }, loader);
    await cache.getOrLoad('players', { limit: 10, page: 1 }, loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('consultas distintas y recursos distintos no se mezclan', async () => {
    const { cache } = service();
    const loader = vi.fn(async () => 'ok');
    await cache.getOrLoad('players', { page: 1 }, loader);
    await cache.getOrLoad('players', { page: 2 }, loader);
    await cache.getOrLoad('tournaments', { page: 1 }, loader);
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it('bump invalida solo el recurso indicado', async () => {
    const { cache } = service();
    let players = 0;
    let tournaments = 0;
    const loadPlayers = async () => ++players;
    const loadTournaments = async () => ++tournaments;

    await cache.getOrLoad('players', {}, loadPlayers);
    await cache.getOrLoad('tournaments', {}, loadTournaments);
    await cache.bump('players');

    expect(await cache.getOrLoad('players', {}, loadPlayers)).toBe(2);
    expect(await cache.getOrLoad('tournaments', {}, loadTournaments)).toBe(1);
  });

  it('un error del cargador se propaga y no se cachea', async () => {
    const { cache } = service();
    await expect(
      cache.getOrLoad('players', {}, async () => {
        throw new Error('falla de negocio');
      }),
    ).rejects.toThrow('falla de negocio');
    expect(await cache.getOrLoad('players', {}, async () => 'ya sí')).toBe('ya sí');
  });

  it('un valor guardado ilegible se trata como ausente', async () => {
    const primary = memory();
    const { cache } = service(primary);
    const loader = vi.fn(async () => ({ v: 1 }));
    await cache.getOrLoad('players', {}, loader);

    // Las versiones se leen normal; todo valor guardado devuelve texto que no es JSON
    vi.spyOn(primary, 'get').mockImplementation(async (key) => (key.startsWith('cache:ver:') ? null : '{no es json'));
    expect(await cache.getOrLoad('players', {}, loader)).toEqual({ v: 1 });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  describe('con almacén principal', () => {
    it('guarda en el principal y no en el respaldo', async () => {
      const primary = memory();
      const { cache, fallback } = service(primary);
      const fallbackSet = vi.spyOn(fallback, 'set');
      const primarySet = vi.spyOn(primary, 'set');

      await cache.getOrLoad('players', {}, async () => 'x');

      expect(primarySet).toHaveBeenCalledTimes(1);
      expect(fallbackSet).not.toHaveBeenCalled();
    });

    it('bump incrementa la versión compartida', async () => {
      const primary = memory();
      const { cache } = service(primary);
      const incr = vi.spyOn(primary, 'incr');
      await cache.bump('players');
      expect(incr).toHaveBeenCalledWith('cache:ver:players');
    });

    it('otra instancia con el mismo almacén ve la invalidación', async () => {
      const shared = memory();
      const a = service(shared).cache;
      const b = service(shared).cache;
      let calls = 0;
      const load = async () => ++calls;

      await a.getOrLoad('players', {}, load);
      expect(await b.getOrLoad('players', {}, load)).toBe(1);
      await a.bump('players');
      expect(await b.getOrLoad('players', {}, load)).toBe(2);
    });
  });

  describe('con el almacén principal caído (RNF04)', () => {
    it('sirve desde el respaldo y no lanza errores', async () => {
      const onError = vi.fn();
      const { cache } = service(broken(), onError);
      const loader = vi.fn(async () => ({ ok: true }));

      expect(await cache.getOrLoad('players', {}, loader)).toEqual({ ok: true });
      expect(await cache.getOrLoad('players', {}, loader)).toEqual({ ok: true });

      expect(loader).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalled();
    });

    it('la invalidación sigue funcionando con el respaldo', async () => {
      const { cache } = service(broken());
      let calls = 0;
      const load = async () => ++calls;
      await cache.getOrLoad('players', {}, load);
      await cache.bump('players');
      expect(await cache.getOrLoad('players', {}, load)).toBe(2);
    });

    it('un aviso que lanza no rompe la petición', async () => {
      const { cache } = service(broken(), () => {
        throw new Error('el registro falló');
      });
      await expect(cache.getOrLoad('players', {}, async () => 1)).resolves.toBe(1);
    });
  });
});

describe('MemoryStore', () => {
  it('incr cuenta desde 1 por clave', async () => {
    const store = memory();
    expect(await store.incr('a')).toBe(1);
    expect(await store.incr('a')).toBe(2);
    expect(await store.incr('b')).toBe(1);
  });

  it('clear borra valores y contadores', async () => {
    const store = memory();
    await store.set('k', 'v', 60);
    await store.incr('c');
    store.clear();
    expect(await store.get('k')).toBeNull();
    expect(await store.incr('c')).toBe(1);
  });

  it('el valor vence con el reloj inyectado', async () => {
    let now = 0;
    const store = new MemoryStore({ capacity: 10, ttlSeconds: 60, now: () => now });
    await store.set('k', 'v', 1);
    now += 1_001;
    expect(await store.get('k')).toBeNull();
  });
});
