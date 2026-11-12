import { z } from 'zod';
import { withAliases } from '../../shared/aliases.js';
import { booleanQuery, listQueryShape, type ListQuery } from '../../shared/pagination.js';

const aliases = withAliases({
  name: ['nombre'],
  description: ['descripcion'],
  minAge: ['edadMinima', 'edadMin'],
  maxAge: ['edadMaxima', 'edadMax'],
  defaultCost: ['costo', 'costoBase'],
  usesElo: ['usaElo'],
});

const age = z
  .number({ error: 'La edad debe ser un número' })
  .int('La edad debe ser un número entero')
  .min(0, 'La edad no puede ser negativa')
  .max(120, 'La edad es demasiado alta');

const cost = z
  .number({ error: 'El costo debe ser un número' })
  .min(0, 'El costo no puede ser negativo')
  .max(1_000_000, 'El costo es demasiado alto')
  .refine((value) => Math.round(value * 100) / 100 === value, 'El costo admite como máximo dos decimales');

const fields = {
  name: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(2, 'El nombre debe tener al menos 2 caracteres')
    .max(80, 'El nombre es demasiado largo'),
  description: z.string().trim().max(500, 'La descripción es demasiado larga').nullable(),
  minAge: age.nullable(),
  maxAge: age.nullable(),
  defaultCost: cost,
  usesElo: z.boolean({ error: 'usesElo debe ser verdadero o falso' }),
};

type AgeRange = { minAge?: number | null | undefined; maxAge?: number | null | undefined };

export const hasValidAgeRange = (value: AgeRange): boolean =>
  value.minAge == null || value.maxAge == null || value.minAge <= value.maxAge;

const ageRangeIssue = { message: 'La edad mínima no puede ser mayor que la máxima', path: ['minAge'] };

export const createCategorySchema = z.preprocess(
  aliases,
  z
    .object({
      name: fields.name,
      description: fields.description.optional(),
      minAge: fields.minAge.optional(),
      maxAge: fields.maxAge.optional(),
      defaultCost: fields.defaultCost.default(0),
      usesElo: fields.usesElo.default(false),
    })
    .refine(hasValidAgeRange, ageRangeIssue),
);

export const updateCategorySchema = z.preprocess(
  aliases,
  z
    .object({
      name: fields.name.optional(),
      description: fields.description.optional(),
      minAge: fields.minAge.optional(),
      maxAge: fields.maxAge.optional(),
      defaultCost: fields.defaultCost.optional(),
      usesElo: fields.usesElo.optional(),
    })
    .refine(hasValidAgeRange, ageRangeIssue)
    .refine((value) => Object.keys(value).length > 0, 'Indica al menos un campo para actualizar'),
);

export const CATEGORY_SORT_FIELDS = ['id', 'name', 'defaultCost', 'createdAt'] as const;

export const listCategoriesQuerySchema = z.object({
  ...listQueryShape(CATEGORY_SORT_FIELDS, 'name', 'asc'),
  q: z.string().trim().min(1).max(80).optional(),
  usaElo: booleanQuery.optional(),
  // Categorías que admiten esa edad (sin límite inferior o superior cuenta como abierta)
  edad: z.coerce.number().int('La edad debe ser un número entero').min(0).max(120).optional(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type ListCategoriesQuery = ListQuery<(typeof CATEGORY_SORT_FIELDS)[number]> & {
  q?: string | undefined;
  usaElo?: boolean | undefined;
  edad?: number | undefined;
};
