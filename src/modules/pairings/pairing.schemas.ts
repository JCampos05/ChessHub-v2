import { z } from 'zod';
import { withAliases } from '../../shared/aliases.js';
import { listQueryShape, type ListQuery } from '../../shared/pagination.js';

const aliases = withAliases({
  tournamentId: ['torneoId', 'tournament_id', 'torneo_id'],
  roundNumber: ['rondaNum', 'ronda', 'round_number', 'numeroRonda'],
  board: ['mesa', 'tablero'],
  whitePlayerId: ['blancasId', 'blancas', 'white_player_id'],
  blackPlayerId: ['negrasId', 'negras', 'black_player_id'],
});

const uuid = (label: string) => z.uuid({ error: `${label} no es un identificador válido` });

const roundNumber = z
  .number({ error: 'El número de ronda debe ser un número' })
  .int('El número de ronda debe ser entero')
  .min(1, 'El número de ronda debe ser al menos 1')
  .max(99, 'El número de ronda es demasiado alto');

const board = z
  .number({ error: 'La mesa debe ser un número' })
  .int('La mesa debe ser entera')
  .min(1, 'La mesa debe ser al menos 1')
  .max(9999, 'La mesa es demasiado alta');

// Sin jugador de negras (null o ausente) el emparejamiento es un descanso (bye)
const blackPlayerId = uuid('El jugador de negras').nullable();

export const createPairingSchema = z.preprocess(
  aliases,
  z.object({
    tournamentId: uuid('El torneo'),
    roundNumber,
    board,
    whitePlayerId: uuid('El jugador de blancas'),
    blackPlayerId: blackPlayerId.optional().transform((value) => value ?? null),
  }),
);

export const updatePairingSchema = z.preprocess(
  aliases,
  z
    .object({
      board: board.optional(),
      whitePlayerId: uuid('El jugador de blancas').optional(),
      blackPlayerId: blackPlayerId.optional(),
    })
    .refine((value) => Object.keys(value).length > 0, 'Indica al menos un campo para actualizar'),
);

export const PAIRING_SORT_FIELDS = ['id', 'board', 'roundNumber', 'createdAt'] as const;

export const listPairingsQuerySchema = z.preprocess(
  withAliases({
    tournamentId: ['torneoId'],
    roundNumber: ['rondaNum', 'ronda'],
    playerId: ['jugadorId'],
  }),
  z.object({
    ...listQueryShape(PAIRING_SORT_FIELDS, 'board', 'asc'),
    tournamentId: uuid('El torneo').optional(),
    roundNumber: z.coerce.number().int().min(1).max(99).optional(),
    playerId: uuid('El jugador').optional(),
  }),
);

export type CreatePairingInput = z.infer<typeof createPairingSchema>;
export type UpdatePairingInput = z.infer<typeof updatePairingSchema>;
export type ListPairingsQuery = ListQuery<(typeof PAIRING_SORT_FIELDS)[number]> & {
  tournamentId?: string | undefined;
  roundNumber?: number | undefined;
  playerId?: string | undefined;
};
