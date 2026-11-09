import { z } from 'zod';

// Fecha de calendario AAAA-MM-DD que realmente existe (rechaza 2026-02-31)
export const calendarDateSchema = z
  .string({ error: 'La fecha es obligatoria' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener el formato AAAA-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'La fecha no es válida');

// Convierte AAAA-MM-DD a una fecha UTC a medianoche (columna DATE)
export function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

// Devuelve AAAA-MM-DD de una columna DATE
export function fromDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}
