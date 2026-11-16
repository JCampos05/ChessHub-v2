import { z } from 'zod';
import { withAliases } from '../../shared/aliases.js';
import { listQueryShape, type ListQuery } from '../../shared/pagination.js';

const uuid = (label: string) => z.uuid({ error: `${label} no es un identificador válido` });

export const createRegistrationSchema = z.preprocess(
  withAliases({
    playerId: ['jugadorId', 'player_id', 'jugador_id'],
    categoryId: ['categoriaId', 'category_id', 'categoria_id'],
  }),
  z.object({
    playerId: uuid('El jugador'),
    categoryId: uuid('La categoría'),
  }),
);

export const REGISTRATION_SORT_FIELDS = ['folio', 'createdAt'] as const;

export const listRegistrationsQuerySchema = z.preprocess(
  withAliases({ categoryId: ['categoriaId'], status: ['estado'], paymentStatus: ['estadoPago'] }),
  z.object({
    ...listQueryShape(REGISTRATION_SORT_FIELDS, 'folio', 'asc'),
    status: z.enum(['ACTIVE', 'CANCELLED']).optional(),
    paymentStatus: z.enum(['PENDING', 'CONFIRMED']).optional(),
    categoryId: uuid('La categoría').optional(),
  }),
);

export type CreateRegistrationInput = z.infer<typeof createRegistrationSchema>;
export type ListRegistrationsQuery = ListQuery<(typeof REGISTRATION_SORT_FIELDS)[number]> & {
  status?: 'ACTIVE' | 'CANCELLED' | undefined;
  paymentStatus?: 'PENDING' | 'CONFIRMED' | undefined;
  categoryId?: string | undefined;
};
