// Serialización estable: dos objetos con las mismas propiedades producen el mismo texto sin importar
// el orden en que llegaron. Las propiedades indefinidas se omiten. Sirve para construir claves de caché.
export function stableStringify(value: unknown): string {
  const text = JSON.stringify(value, (_key, item: unknown) => {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    }
    return item;
  });
  return text ?? 'null';
}
