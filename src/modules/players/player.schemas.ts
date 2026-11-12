import { z } from 'zod';
import { withAliases } from '../../shared/aliases.js';
import { calendarDateSchema } from '../../shared/dates.js';
import { booleanQuery, listQueryShape, type ListQuery } from '../../shared/pagination.js';
import { csvList } from '../../shared/query-lists.js';
import { withNameAlias } from '../auth/auth.schemas.js';

const extraAliases = withAliases({
  birthDate: ['fechaNacimiento'],
  sex: ['sexo'],
  clubCode: ['club'],
  ratingElo: ['rating'],
  fideId: ['idFide'],
});

const withPlayerAliases = (raw: unknown): unknown => extraAliases(withNameAlias(raw));

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === '' ? undefined : value));

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable();

const birthDate = calendarDateSchema.refine(
  (value) => value <= new Date().toISOString().slice(0, 10),
  'La fecha no puede ser futura',
);

const sex = z.enum(['M', 'F'], { error: 'El sexo debe ser M o F' });

const federation = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'La federación debe tener 3 letras');

const fullName = z
  .string({ error: 'El nombre completo es obligatorio' })
  .trim()
  .min(3, 'El nombre completo debe tener al menos 3 caracteres')
  .max(150, 'El nombre completo es demasiado largo');

const email = z.string().trim().toLowerCase().pipe(z.email('Correo electrónico inválido'));

// Un decimal como máximo (ejemplo real: 1550.6)
const ratingElo = z
  .number({ error: 'El rating debe ser un número' })
  .min(0, 'El rating no puede ser negativo')
  .max(3000, 'El rating no puede superar 3000')
  .refine((value) => Math.round(value * 10) / 10 === value, 'El rating admite como máximo un decimal');

const kFactor = z
  .number({ error: 'El factor K debe ser un número' })
  .refine((value) => [10, 20, 30, 40].includes(value), 'El factor K debe ser 10, 20, 30 o 40');

export const createPlayerSchema = z.preprocess(
  withPlayerAliases,
  z.object({
    fullName,
    birthDate: birthDate.optional(),
    sex: sex.optional(),
    federation: federation.default('MEX'),
    fideId: optionalText(20),
    nationalId: optionalText(20),
    clubCode: optionalText(30),
    email: email.optional(),
    phone: optionalText(30),
  }),
);

// Los campos opcionales aceptan null para borrar el valor
export const updatePlayerSchema = z.preprocess(
  withPlayerAliases,
  z
    .object({
      fullName: fullName.optional(),
      birthDate: birthDate.nullable().optional(),
      sex: sex.nullable().optional(),
      federation: federation.optional(),
      fideId: nullableText(20).optional(),
      nationalId: nullableText(20).optional(),
      clubCode: nullableText(30).optional(),
      email: email.nullable().optional(),
      phone: nullableText(30).optional(),
      status: z.enum(['PENDING', 'ACTIVE', 'INACTIVE'], { error: 'Estado no válido' }).optional(),
      ratingElo: ratingElo.nullable().optional(),
      kFactor: kFactor.nullable().optional(),
    })
    .refine((value) => Object.keys(value).length > 0, 'Indica al menos un campo para actualizar'),
);

export const PLAYER_SORT_FIELDS = ['id', 'fullName', 'ratingElo', 'birthDate', 'createdAt'] as const;

const rating = z.coerce.number().min(0).max(3000);
const age = z.coerce.number().int('La edad debe ser un número entero').min(0).max(120);

const playerStatus = z.enum(['PENDING', 'ACTIVE', 'INACTIVE'], { error: 'Estado no válido' });

export const listPlayersQuerySchema = z
  .object({
    ...listQueryShape(PLAYER_SORT_FIELDS, 'createdAt', 'desc'),
    includeInactive: booleanQuery.default(false),
    q: z.string().trim().min(1).max(100).optional(),
    // Valores múltiples separados por coma: status=ACTIVE,PENDING
    club: csvList(z.string().min(1).max(30)).optional(),
    ratingMin: rating.optional(),
    ratingMax: rating.optional(),
    status: csvList(playerStatus).optional(),
    federation: csvList(federation).optional(),
    fideId: z.string().trim().min(1).max(20).optional(),
    sex: sex.optional(),
    // Años cumplidos a la fecha de hoy
    edadMin: age.optional(),
    edadMax: age.optional(),
  })
  .refine(
    (value) => value.ratingMin === undefined || value.ratingMax === undefined || value.ratingMin <= value.ratingMax,
    { message: 'ratingMin no puede ser mayor que ratingMax', path: ['ratingMin'] },
  )
  .refine((value) => value.edadMin === undefined || value.edadMax === undefined || value.edadMin <= value.edadMax, {
    message: 'edadMin no puede ser mayor que edadMax',
    path: ['edadMin'],
  });

export type CreatePlayerInput = z.infer<typeof createPlayerSchema>;
export type UpdatePlayerInput = z.infer<typeof updatePlayerSchema>;
export type ListPlayersQuery = ListQuery<(typeof PLAYER_SORT_FIELDS)[number]> & {
  q?: string | undefined;
  club?: string[] | undefined;
  ratingMin?: number | undefined;
  ratingMax?: number | undefined;
  status?: ('PENDING' | 'ACTIVE' | 'INACTIVE')[] | undefined;
  federation?: string[] | undefined;
  fideId?: string | undefined;
  sex?: 'M' | 'F' | undefined;
  edadMin?: number | undefined;
  edadMax?: number | undefined;
};
