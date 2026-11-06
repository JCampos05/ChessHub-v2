import { normalizeName } from './normalize.js';

export function nameKey(name: string): string {
  const normalized = normalizeName(name);
  if (normalized === '') return '';
  return normalized.split(' ').sort().join(' ');
}
