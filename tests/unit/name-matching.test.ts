import { describe, expect, it } from 'vitest';
import { nameKey } from '../../src/domain/name-matching/name-key.js';
import { normalizeName } from '../../src/domain/name-matching/normalize.js';

describe('normalizeName (RF-JUG-02)', () => {
  it('quita acentos y pasa a minúsculas', () => {
    expect(normalizeName('Ordoñez')).toBe('ordonez');
    expect(normalizeName('Cruz Urías')).toBe('cruz urias');
  });

  it('colapsa espacios dobles y recorta extremos', () => {
    expect(normalizeName('  Acosta   Araujo  Carlos ')).toBe('acosta araujo carlos');
  });

  it('elimina signos de puntuación', () => {
    expect(normalizeName('Pérez, Juan')).toBe('perez juan');
  });

  it('devuelve cadena vacía si no hay letras', () => {
    expect(normalizeName('  ,, ')).toBe('');
  });
});

describe('nameKey (RF-JUG-02)', () => {
  it('es igual sin importar el orden de apellidos y nombres', () => {
    expect(nameKey('Cruz Urías Walter')).toBe(nameKey('Walter Cruz Urias'));
  });

  it('distingue nombres distintos', () => {
    expect(nameKey('Cruz Urías Walter')).not.toBe(nameKey('Cruz Urías Walter Oswaldo'));
  });

  it('ignora acentos, mayúsculas y espacios', () => {
    expect(nameKey('ORDOÑEZ  luis')).toBe(nameKey('luis ordonez'));
  });
});
