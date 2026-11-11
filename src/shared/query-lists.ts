import { z } from 'zod';

// Máximo de valores en un filtro múltiple (status=ACTIVE,PENDING)
export const MAX_LIST_VALUES = 10;

// Filtro de valores múltiples separados por coma 
export function csvList<T extends z.ZodType>(item: T, max: number = MAX_LIST_VALUES) {
  return z.preprocess(
    (raw) => (Array.isArray(raw) ? raw.join(',') : raw),
    z.string().transform((raw, ctx): z.output<T>[] => {
      const parts = [...new Set(raw.split(',').map((part) => part.trim()).filter((part) => part !== ''))];

      if (parts.length === 0) {
        ctx.addIssue({ code: 'custom', message: 'Indica al menos un valor' });
        return z.NEVER;
      }
      if (parts.length > max) {
        ctx.addIssue({ code: 'custom', message: `Se admiten como máximo ${max} valores` });
        return z.NEVER;
      }

      const values: z.output<T>[] = [];
      for (const part of parts) {
        const parsed = item.safeParse(part);
        if (!parsed.success) {
          ctx.addIssue({ code: 'custom', message: parsed.error.issues[0]?.message ?? 'Valor no válido' });
          return z.NEVER;
        }
        // Dos escrituras distintas pueden dar el mismo valor (por ejemplo `1` y `convocatoria`)
        if (!values.includes(parsed.data)) values.push(parsed.data);
      }
      return values;
    }),
  );
}
