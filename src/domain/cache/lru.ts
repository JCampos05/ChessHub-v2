// Caché LRU con capacidad acotada y vencimiento por entrada. El reloj se inyecta
// para poder probar el vencimiento sin esperar.

export interface LruOptions {
  capacity: number;
  ttlMs: number;
  now?: () => number;
}

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class LruCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly capacity: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: LruOptions) {
    if (!Number.isInteger(options.capacity) || options.capacity < 1) {
      throw new RangeError('La capacidad debe ser un entero positivo');
    }
    if (!(options.ttlMs > 0)) throw new RangeError('El tiempo de vida debe ser positivo');
    this.capacity = options.capacity;
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Lo vuelve a insertar al final: el orden del mapa es el orden de uso
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, ttlMs: number = this.ttlMs): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
