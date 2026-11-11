import { describe, expect, it } from 'vitest';
import { LruCache } from '../../src/domain/cache/lru.js';

function withClock() {
  let now = 1_000;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe('LruCache (RF13)', () => {
  it('guarda y devuelve valores; una clave ausente devuelve undefined', () => {
    const cache = new LruCache<string>({ capacity: 3, ttlMs: 1000 });
    cache.set('a', '1');
    expect(cache.get('a')).toBe('1');
    expect(cache.get('b')).toBeUndefined();
  });

  it('expulsa el elemento menos usado al superar la capacidad', () => {
    const cache = new LruCache<number>({ capacity: 2, ttlMs: 1000 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });

  it('leer una clave la marca como reciente y evita su expulsión', () => {
    const cache = new LruCache<number>({ capacity: 2, ttlMs: 1000 });
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
  });

  it('reescribir una clave actualiza el valor sin crecer', () => {
    const cache = new LruCache<number>({ capacity: 2, ttlMs: 1000 });
    cache.set('a', 1);
    cache.set('a', 2);
    expect(cache.get('a')).toBe(2);
    expect(cache.size).toBe(1);
  });

  it('las entradas vencen según su tiempo de vida', () => {
    const clock = withClock();
    const cache = new LruCache<string>({ capacity: 5, ttlMs: 1000, now: clock.now });
    cache.set('a', 'x');
    clock.advance(999);
    expect(cache.get('a')).toBe('x');
    clock.advance(1);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('admite un tiempo de vida propio por entrada', () => {
    const clock = withClock();
    const cache = new LruCache<string>({ capacity: 5, ttlMs: 10_000, now: clock.now });
    cache.set('corta', 'x', 100);
    cache.set('larga', 'y');
    clock.advance(500);
    expect(cache.get('corta')).toBeUndefined();
    expect(cache.get('larga')).toBe('y');
  });

  it('delete y clear vacían entradas', () => {
    const cache = new LruCache<number>({ capacity: 5, ttlMs: 1000 });
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.delete('a')).toBe(true);
    expect(cache.delete('a')).toBe(false);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it.each([0, -1, 1.5, Number.NaN])('rechaza una capacidad inválida (%s)', (capacity) => {
    expect(() => new LruCache({ capacity, ttlMs: 1000 })).toThrow(RangeError);
  });

  it.each([0, -5, Number.NaN])('rechaza un tiempo de vida inválido (%s)', (ttlMs) => {
    expect(() => new LruCache({ capacity: 2, ttlMs })).toThrow(RangeError);
  });
});
