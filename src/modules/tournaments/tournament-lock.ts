import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';

export type Tx = Prisma.TransactionClient;

const TX_OPTIONS = { maxWait: 15_000, timeout: 30_000 } as const;

// Ejecuta el trabajo dentro de una transacción con el torneo bloqueado: dos operaciones del mismo torneo
// (generar una ronda, cambiar su estado) se serializan y la segunda ve lo que dejó la primera. Prisma no tiene
// bloqueo explícito; escribir la fila del torneo toma su candado exclusivo hasta el commit (igual que FOR UPDATE)
// y bloquea también las inscripciones que intenten reservar o liberar cupo mientras tanto
export function runWithTournamentLocked<T>(tournamentId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.tournament.updateMany({ where: { id: tournamentId }, data: { updatedAt: new Date() } });
    return work(tx);
  }, TX_OPTIONS);
}
