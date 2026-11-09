import { z } from 'zod';
import { withAliases } from '../../shared/aliases.js';
import { listQueryShape, type ListQuery } from '../../shared/pagination.js';

const aliases = withAliases({
  tournamentId: ['torneoId', 'tournament_id', 'torneo_id'],
  number: ['numero', 'rondaNum', 'ronda'],
});

const uuid = (label: string) => z.uuid({ error: `${label} no es un identificador válido` });

const number = z
  .number({ error: 'El número de ronda debe ser un número' })
  .int('El número de ronda debe ser entero')
  .min(1, 'El número de ronda debe ser al menos 1')
  .max(99, 'El número de ronda es demasiado alto');

// El estado de la ronda no se envía: lo cambia el flujo de la competencia
export const createRoundSchema = z.preprocess(
  aliases,
  z.object({
    tournamentId: uuid('El torneo'),
    number,
  }),
);

export const updateRoundSchema = z.preprocess(
  aliases,
  z
    .object({ number: number.optional() })
    .refine((value) => Object.keys(value).length > 0, 'Indica al menos un campo para actualizar'),
);

export const ROUND_SORT_FIELDS = ['id', 'number', 'createdAt'] as const;

const statusFilter = z.enum(['PENDING', 'IN_PROGRESS', 'FINISHED']);

export const listRoundsQuerySchema = z.preprocess(
  withAliases({ tournamentId: ['torneoId'] }),
  z.object({
    ...listQueryShape(ROUND_SORT_FIELDS, 'number', 'asc'),
    tournamentId: uuid('El torneo').optional(),
    status: statusFilter.optional(),
  }),
);

export type CreateRoundInput = z.infer<typeof createRoundSchema>;
export type UpdateRoundInput = z.infer<typeof updateRoundSchema>;
export type ListRoundsQuery = ListQuery<(typeof ROUND_SORT_FIELDS)[number]> & {
  tournamentId?: string | undefined;
  status?: 'PENDING' | 'IN_PROGRESS' | 'FINISHED' | undefined;
};
