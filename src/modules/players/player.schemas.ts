import { z } from 'zod';
import { withNameAlias } from '../auth/auth.schemas.js';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === '' ? undefined : value));

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener el formato AAAA-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'La fecha no es válida')
  .refine((value) => value <= new Date().toISOString().slice(0, 10), 'La fecha no puede ser futura');

export const createPlayerSchema = z.preprocess(
  withNameAlias,
  z.object({
    fullName: z
      .string({ error: 'El nombre completo es obligatorio' })
      .trim()
      .min(3, 'El nombre completo debe tener al menos 3 caracteres')
      .max(150, 'El nombre completo es demasiado largo'),
    birthDate: calendarDate.optional(),
    sex: z.enum(['M', 'F'], { error: 'El sexo debe ser M o F' }).optional(),
    federation: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'La federación debe tener 3 letras')
      .default('MEX'),
    fideId: optionalText(20),
    nationalId: optionalText(20),
    clubCode: optionalText(30),
    email: z.string().trim().toLowerCase().pipe(z.email('Correo electrónico inválido')).optional(),
    phone: optionalText(30),
  }),
);

export type CreatePlayerInput = z.infer<typeof createPlayerSchema>;
