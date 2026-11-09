import { z } from 'zod';

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

// Los parámetros de consulta llegan como texto: 'true' y 'false' son los únicos valores válidos
export const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true');

const lowerCase = (value: unknown) => (typeof value === 'string' ? value.toLowerCase() : value);

export interface ListQuery<S extends string> {
  page: number;
  limit: number;
  sortBy: S;
  order: 'asc' | 'desc';
  includeInactive: boolean;
}

// Paginación, orden y baja lógica comunes a todos los listados.
// sortBy solo admite los campos de la lista blanca; order acepta asc/desc en cualquier capitalización.
export function listQueryShape<const F extends readonly [string, ...string[]]>(
  sortFields: F,
  defaultSort: F[number],
  defaultOrder: 'asc' | 'desc' = 'desc',
) {
  return {
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sortBy: z.enum(sortFields).default(defaultSort),
    order: z.preprocess(lowerCase, z.enum(['asc', 'desc']).default(defaultOrder)),
    includeInactive: booleanQuery.default(false),
  };
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function buildMeta(page: number, limit: number, total: number): PaginationMeta {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

export function paginate<T>(data: T[], page: number, limit: number, total: number) {
  return { data, meta: buildMeta(page, limit, total) };
}

export function toSkipTake(page: number, limit: number) {
  return { skip: (page - 1) * limit, take: limit };
}
