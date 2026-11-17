import { z } from 'zod';
import { withAliases } from '../../shared/aliases.js';
import { calendarDateSchema } from '../../shared/dates.js';
import { listQueryShape, type ListQuery } from '../../shared/pagination.js';
import { RATING_PACES, RATING_SYSTEMS } from '../../domain/ratings/resolve.js';

const system = z.enum(RATING_SYSTEMS, { error: 'El sistema debe ser FIDE, NATIONAL o STATE' });
const pace = z.enum(RATING_PACES, { error: 'El ritmo debe ser STANDARD, RAPID o BLITZ' });

// Código de estado en mayúsculas (por ejemplo SIN, JAL, CMX)
export const stateCode = z
  .string({ error: 'El estado debe ser texto' })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2,5}$/, 'El estado debe tener de 2 a 5 letras');

// Un decimal como máximo, igual que el rating único de jugadores
const value = z
  .number({ error: 'El valor del rating debe ser un número' })
  .min(0, 'El rating no puede ser negativo')
  .max(3500, 'El rating no puede superar 3500')
  .refine((n) => Math.round(n * 10) / 10 === n, 'El rating admite como máximo un decimal');

export const createRatingSchema = z.preprocess(
  withAliases({
    system: ['sistema'],
    pace: ['ritmo'],
    value: ['valor', 'rating'],
    stateCode: ['estado', 'state_code'],
    validFrom: ['vigenteDesde', 'valid_from'],
  }),
  z
    .object({
      system,
      pace,
      value,
      stateCode: stateCode.optional(),
      validFrom: calendarDateSchema.optional(),
    })
    .superRefine((input, ctx) => {
      if (input.system === 'STATE' && input.stateCode === undefined) {
        ctx.addIssue({ code: 'custom', path: ['stateCode'], message: 'El rating estatal requiere el estado' });
      }
      if (input.system !== 'STATE' && input.stateCode !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['stateCode'], message: 'Solo el rating estatal lleva estado' });
      }
    }),
);

export const RATING_SORT_FIELDS = ['validFrom', 'createdAt'] as const;

export const listRatingsQuerySchema = z.preprocess(
  withAliases({ system: ['sistema'], pace: ['ritmo'] }),
  z.object({
    ...listQueryShape(RATING_SORT_FIELDS, 'validFrom', 'desc'),
    system: system.optional(),
    pace: pace.optional(),
  }),
);

export type CreateRatingInput = z.infer<typeof createRatingSchema>;
export type ListRatingsQuery = ListQuery<(typeof RATING_SORT_FIELDS)[number]> & {
  system?: (typeof RATING_SYSTEMS)[number] | undefined;
  pace?: (typeof RATING_PACES)[number] | undefined;
};
