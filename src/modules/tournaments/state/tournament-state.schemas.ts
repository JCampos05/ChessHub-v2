import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/pagination.js';
import { parseTournamentStatus, type TournamentStatusCode } from '../tournament-status.js';

const reasonField = z.string().trim().max(500, 'El motivo admite como máximo 500 caracteres').optional();
const stateField = z.union([z.string(), z.number()]).optional();

// «motivo» y su alias «reason»; un motivo vacío equivale a no enviarlo
const pickReason = (value: { motivo?: string | undefined; reason?: string | undefined }): string | undefined => {
  const reason = value.motivo ?? value.reason;
  return reason === undefined || reason === '' ? undefined : reason;
};

export interface ChangeStateInput {
  to: TournamentStatusCode;
  reason: string | undefined;
}

// Cuerpo de PATCH /torneos/:id/estado: el estado puede ir como código, nombre en español o número (1 a 6)
export const changeStateSchema = z
  .object({ estado: stateField, status: stateField, motivo: reasonField, reason: reasonField })
  .transform((value, ctx): ChangeStateInput => {
    const raw = value.estado ?? value.status;
    const to = raw === undefined ? undefined : parseTournamentStatus(String(raw));
    if (to === undefined) {
      ctx.issues.push({
        code: 'custom',
        input: value,
        path: ['estado'],
        message:
          raw === undefined
            ? 'El estado es obligatorio'
            : 'Estado no válido: usa convocatoria, inscripciones_cerradas, en_juego, ronda_en_curso, finalizado o cancelado',
      });
      return z.NEVER;
    }
    return { to, reason: pickReason(value) };
  });

// Cuerpo de las rutas por nombre (/en_juego, /cancelado...): puede faltar o ir vacío; solo /cancelado usa el motivo
export const namedStateSchema = z
  .object({ motivo: reasonField, reason: reasonField })
  .transform((value) => ({ reason: pickReason(value) }));

export type NamedStateInput = z.output<typeof namedStateSchema>;

export const stateHistoryQuerySchema = paginationQuerySchema.pick({ page: true, limit: true });

export type StateHistoryQuery = z.infer<typeof stateHistoryQuerySchema>;
