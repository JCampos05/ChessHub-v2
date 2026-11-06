import { z } from 'zod';

export function withNameAlias(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const input = raw as Record<string, unknown>;
  const fullName = input['fullName'] ?? input['fullname'] ?? input['name'] ?? input['nombre'];
  return fullName === undefined ? input : { ...input, fullName };
}

const email = z
  .string({ error: 'El correo electrónico es obligatorio' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Correo electrónico inválido' }).max(254, 'El correo es demasiado largo'));

const password = z
  .string({ error: 'La contraseña es obligatoria' })
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'La contraseña no puede exceder 72 bytes')
  .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), 'La contraseña debe incluir letras y números');

export const registerSchema = z.preprocess(
  withNameAlias,
  z.object({
    email,
    password,
    fullName: z.string().trim().min(1, 'El nombre no puede estar vacío').max(120).optional(),
  }),
);

export const loginSchema = z.object({
  email: z
    .string({ error: 'El correo electrónico es obligatorio' })
    .trim()
    .min(1, 'El correo electrónico es obligatorio')
    .toLowerCase(),
  password: z
    .string({ error: 'La contraseña es obligatoria' })
    .min(1, 'La contraseña es obligatoria')
    .max(1024),
});

export const refreshSchema = z.object({
  refreshToken: z
    .string({ error: 'El refreshToken es obligatorio' })
    .min(1, 'El refreshToken es obligatorio'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
