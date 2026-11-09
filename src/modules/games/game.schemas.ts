import { z } from 'zod';
import { withAliases } from '../../shared/aliases.js';
import { listQueryShape, type ListQuery } from '../../shared/pagination.js';

const aliases = withAliases({
  tournamentId: ['torneoId', 'tournament_id', 'torneo_id'],
  roundNumber: ['rondaNum', 'ronda', 'round_number', 'numeroRonda'],
  pairingId: ['emparejamientoId', 'pairing_id'],
  whitePlayerId: ['blancasId', 'blancas', 'white_player_id'],
  blackPlayerId: ['negrasId', 'negras', 'black_player_id'],
  playedAt: ['jugadaEn', 'fechaJuego', 'played_at'],
});

const uuid = (label: string) => z.uuid({ error: `${label} no es un identificador válido` });

const roundNumber = z
  .number({ error: 'El número de ronda debe ser un número' })
  .int('El número de ronda debe ser entero')
  .min(1, 'El número de ronda debe ser al menos 1')
  .max(99, 'El número de ronda es demasiado alto');

const pgn = z.string({ error: 'El PGN debe ser texto' }).trim().min(1, 'El PGN no puede ir vacío').max(20000, 'El PGN es demasiado largo');

const playedAt = z.iso
  .datetime({ offset: true, error: 'La fecha de juego debe ser una fecha y hora ISO 8601' })
  .transform((value) => new Date(value));

export const createGameSchema = z.preprocess(
  aliases,
  z.object({
    tournamentId: uuid('El torneo'),
    roundNumber,
    whitePlayerId: uuid('El jugador de blancas'),
    blackPlayerId: uuid('El jugador de negras'),
    pairingId: uuid('El emparejamiento').nullable().optional().transform((value) => value ?? null),
    pgn: pgn.nullable().optional().transform((value) => value ?? null),
    playedAt: playedAt.nullable().optional().transform((value) => value ?? null),
  }),
);

export const updateGameSchema = z.preprocess(
  aliases,
  z
    .object({
      pgn: pgn.nullable().optional(),
      playedAt: playedAt.nullable().optional(),
    })
    .refine((value) => Object.keys(value).length > 0, 'Indica al menos un campo para actualizar'),
);

export const GAME_SORT_FIELDS = ['id', 'roundNumber', 'playedAt', 'createdAt'] as const;

export const listGamesQuerySchema = z.preprocess(
  withAliases({
    tournamentId: ['torneoId'],
    roundNumber: ['rondaNum', 'ronda'],
    playerId: ['jugadorId'],
    result: ['resultado'],
  }),
  z.object({
    ...listQueryShape(GAME_SORT_FIELDS, 'createdAt', 'asc'),
    tournamentId: uuid('El torneo').optional(),
    roundNumber: z.coerce.number().int().min(1).max(99).optional(),
    playerId: uuid('El jugador').optional(),
    result: z.enum(['PENDING', 'WHITE_WINS', 'BLACK_WINS', 'DRAW']).optional(),
  }),
);

export type CreateGameInput = z.infer<typeof createGameSchema>;
export type UpdateGameInput = z.infer<typeof updateGameSchema>;
export type ListGamesQuery = ListQuery<(typeof GAME_SORT_FIELDS)[number]> & {
  tournamentId?: string | undefined;
  roundNumber?: number | undefined;
  playerId?: string | undefined;
  result?: 'PENDING' | 'WHITE_WINS' | 'BLACK_WINS' | 'DRAW' | undefined;
};
