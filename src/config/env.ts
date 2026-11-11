import 'dotenv/config';
import { z } from 'zod';

const NODE_ENVS = ['development', 'test', 'production'] as const;
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const MIN_BCRYPT_COST = 12;
const MAX_BCRYPT_COST = 15;

const envSchema = z.object({
    NODE_ENV: z.enum(NODE_ENVS).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string()
      .regex(/^postgres(ql)?:\/\//, 'debe ser una URL de PostgreSQL (postgresql://usuario:clave@host:5432/base)'),

    JWT_SECRET: z.string().min(32, 'debe tener al menos 32 caracteres'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),

    BCRYPT_COST: z.coerce.number().int().min(4).max(MAX_BCRYPT_COST).default(MIN_BCRYPT_COST),

    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0),
      ),

    // Sin REDIS_URL la caché usa solo la memoria del proceso (LRU)
    REDIS_URL: z
      .string()
      .regex(/^rediss?:\/\//, 'debe ser una URL de Redis (redis://host:6379)')
      .optional(),
    CACHE_TTL_SECONDS: z.coerce.number().int().min(1).max(3600).default(60),
    CACHE_LRU_CAPACITY: z.coerce.number().int().min(10).max(100_000).default(500),

    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    MAIL_FROM: z.string().default('ChessHub <no-reply@chesshub.local>'),

    APP_BASE_URL: z.url().default('http://localhost:3000'),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    STORAGE_DIR: z.string().default('./storage'),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.NODE_ENV !== 'test' && cfg.BCRYPT_COST < MIN_BCRYPT_COST) {
      ctx.addIssue({
        code: 'custom',
        path: ['BCRYPT_COST'],
        message: `fuera de NODE_ENV=test debe ser al menos ${MIN_BCRYPT_COST}`,
      });
    }

    if (cfg.NODE_ENV === 'production') {
      if (cfg.CORS_ORIGINS.includes('*')) {
        ctx.addIssue({
          code: 'custom',
          path: ['CORS_ORIGINS'],
          message: "en producción no se permite '*'",
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );

  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(general)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuración de entorno inválida:\n${details}`);
  }
  return result.data;
}

export const env: Env = parseEnv(process.env);
