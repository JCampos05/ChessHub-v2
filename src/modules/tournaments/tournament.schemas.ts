import { z } from 'zod';
import { withAliases } from '../../shared/aliases.js';
import { calendarDateSchema } from '../../shared/dates.js';
import { booleanQuery, listQueryShape, type ListQuery } from '../../shared/pagination.js';
import { csvList } from '../../shared/query-lists.js';
import { parseTournamentStatus, type TournamentStatusCode } from './tournament-status.js';

const aliases = withAliases({
  name: ['nombre'],
  description: ['descripcion'],
  venue: ['sede'],
  city: ['ciudad'],
  startDate: ['fechaInicio', 'fecha_inicio'],
  endDate: ['fechaFin', 'fecha_fin'],
  roundsPlanned: ['rondas', 'numRondas'],
  maxPlayers: ['cupo', 'maxJugadores'],
  timeControl: ['ritmo', 'controlTiempo'],
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const optionalText = (max: number) => z.string().trim().max(max, 'El texto es demasiado largo').nullable();

const fields = {
  name: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(3, 'El nombre debe tener al menos 3 caracteres')
    .max(150, 'El nombre es demasiado largo'),
  description: optionalText(2000),
  venue: optionalText(200),
  city: optionalText(100),
  startDate: calendarDateSchema,
  endDate: calendarDateSchema,
  roundsPlanned: z
    .number({ error: 'El número de rondas debe ser un número' })
    .int('El número de rondas debe ser entero')
    .min(1, 'Debe haber al menos una ronda')
    .max(30, 'El número de rondas es demasiado alto')
    .nullable(),
  maxPlayers: z
    .number({ error: 'El cupo debe ser un número' })
    .int('El cupo debe ser entero')
    .min(2, 'El cupo mínimo es de 2 jugadores')
    .max(10_000, 'El cupo es demasiado alto')
    .nullable(),
  timeControl: optionalText(60),
};

// Las fechas AAAA-MM-DD se comparan como texto
export const hasValidDateRange = (value: { startDate?: string | undefined; endDate?: string | undefined }): boolean =>
  value.startDate === undefined || value.endDate === undefined || value.endDate >= value.startDate;

const dateRangeIssue = { message: 'La fecha de fin no puede ser anterior a la de inicio', path: ['endDate'] };

export const createTournamentSchema = z.preprocess(
  aliases,
  z
    .object({
      name: fields.name,
      description: fields.description.optional(),
      venue: fields.venue.optional(),
      city: fields.city.optional(),
      startDate: fields.startDate,
      endDate: fields.endDate,
      roundsPlanned: fields.roundsPlanned.optional(),
      maxPlayers: fields.maxPlayers.optional(),
      timeControl: fields.timeControl.optional(),
    })
    .refine(hasValidDateRange, dateRangeIssue),
);

// El estado no se edita aquí: lo cambia la máquina de estados -> tournament.status.ts
export const updateTournamentSchema = z.preprocess(
  aliases,
  z
    .object({
      name: fields.name.optional(),
      description: fields.description.optional(),
      venue: fields.venue.optional(),
      city: fields.city.optional(),
      startDate: fields.startDate.optional(),
      endDate: fields.endDate.optional(),
      roundsPlanned: fields.roundsPlanned.optional(),
      maxPlayers: fields.maxPlayers.optional(),
      timeControl: fields.timeControl.optional(),
    })
    .refine(hasValidDateRange, dateRangeIssue)
    .refine((value) => Object.keys(value).length > 0, 'Indica al menos un campo para actualizar'),
);

export const TOURNAMENT_SORT_FIELDS = ['id', 'name', 'startDate', 'endDate', 'city', 'createdAt'] as const;

const statusItem = z.string().transform((value, ctx) => {
  const status = parseTournamentStatus(value);
  if (!status) {
    ctx.addIssue({
      code: 'custom',
      message: 'Estado no válido. Usa convocatoria, inscripciones_cerradas, en_juego, ronda_en_curso, finalizado o cancelado',
    });
    return z.NEVER;
  }
  return status;
});

const queryAliases = withAliases({ city: ['ciudad'] });

export const listTournamentsQuerySchema = z.preprocess(
  queryAliases,
  z.object({
    ...listQueryShape(TOURNAMENT_SORT_FIELDS, 'startDate', 'desc'),
    q: z.string().trim().min(1).max(100).optional(),
    // Valores múltiples: estado=1,2 o estado=convocatoria,en_juego
    estado: csvList(statusItem).optional(),
    city: z.string().trim().min(1).max(100).optional(),
    categoryId: z.string().regex(UUID_PATTERN, 'El identificador de la categoría no es válido').optional(),
    // abiertas=true: en convocatoria y con fecha de inicio posterior a hoy. abiertas=false no filtra.
    abiertas: booleanQuery.optional(),
    desde: calendarDateSchema.optional(),
    hasta: calendarDateSchema.optional(),
  }),
);

export type CreateTournamentInput = z.infer<typeof createTournamentSchema>;
export type UpdateTournamentInput = z.infer<typeof updateTournamentSchema>;
export type ListTournamentsQuery = ListQuery<(typeof TOURNAMENT_SORT_FIELDS)[number]> & {
  q?: string | undefined;
  estado?: TournamentStatusCode[] | undefined;
  city?: string | undefined;
  categoryId?: string | undefined;
  abiertas?: boolean | undefined;
  desde?: string | undefined;
  hasta?: string | undefined;
};
