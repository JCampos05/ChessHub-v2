import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { toSkipTake } from '../../shared/pagination.js';
import type { ListRegistrationsQuery } from './registration.schemas.js';

const withPlayer = { player: { select: { id: true, fullName: true } } } as const;

type RegistrationWithPlayer = Prisma.RegistrationGetPayload<{ include: typeof withPlayer }>;

export type ReserveResult =
  | { ok: true; registration: RegistrationWithPlayer }
  | { ok: false; reason: 'CLOSED' | 'FULL' };

// Con muchas peticiones simultáneas por el mismo torneo, las transacciones esperan el candado de fila;
// los tiempos por omisión de Prisma (2 s para obtener conexión, 5 s de ejecución) se quedan cortos
const TX_OPTIONS = { maxWait: 15_000, timeout: 20_000 } as const;

export interface NewRegistration {
  tournamentId: string;
  categoryId: string;
  playerId: string;
  createdById: string;
}

export const registrationRepository = {
  // Reserva cupo y folio con una sola sentencia UPDATE condicional y da de alta la inscripción en la misma
  // transacción. La condición (hay cupo y el torneo admite inscripciones) se evalúa en la base, no en el código, así
  // que dos peticiones simultáneas no pueden pasar del cupo. Si el INSERT falla (p. ej. jugador ya inscrito), todo se
  // revierte y el contador queda como estaba.
  reserveAndCreate(data: NewRegistration): Promise<ReserveResult> {
    return prisma.$transaction(async (tx) => {
      const reserved = await tx.tournament.updateMany({
        where: {
          id: data.tournamentId,
          isActive: true,
          status: 'REGISTRATION_OPEN',
          OR: [{ maxPlayers: null }, { registeredCount: { lt: tx.tournament.fields.maxPlayers } }],
        },
        data: { registeredCount: { increment: 1 }, registrationCounter: { increment: 1 } },
      });

      if (reserved.count === 0) {
        // Sin fila: o ya no admite inscripciones o se llenó el cupo
        const current = await tx.tournament.findUnique({ where: { id: data.tournamentId }, select: { status: true } });
        return { ok: false, reason: current?.status === 'REGISTRATION_OPEN' ? 'FULL' : 'CLOSED' } as const;
      }

      // La fila queda bloqueada por nuestro UPDATE hasta el commit: el contador leído es el que acabamos de reservar
      const { registrationCounter } = await tx.tournament.findUniqueOrThrow({
        where: { id: data.tournamentId },
        select: { registrationCounter: true },
      });
      const registration = await tx.registration.create({
        data: { ...data, folio: registrationCounter },
        include: withPlayer,
      });
      return { ok: true, registration } as const;
    }, TX_OPTIONS);
  },

  findInTournament(tournamentId: string, id: string) {
    return prisma.registration.findFirst({ where: { id, tournamentId }, include: withPlayer });
  },

  // Cancela solo si seguía activa y libera el cupo en la misma transacción; devuelve false si ya estaba cancelada
  cancel(tournamentId: string, id: string, userId: string): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const changed = await tx.registration.updateMany({
        where: { id, tournamentId, status: 'ACTIVE' },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: userId },
      });
      if (changed.count === 0) return false;
      await tx.tournament.update({ where: { id: tournamentId }, data: { registeredCount: { decrement: 1 } } });
      return true;
    }, TX_OPTIONS);
  },

  // Pasa el pago de PENDING a CONFIRMED solo una vez
  async confirmPayment(tournamentId: string, id: string, userId: string): Promise<boolean> {
    const changed = await prisma.registration.updateMany({
      where: { id, tournamentId, status: 'ACTIVE', paymentStatus: 'PENDING' },
      data: { paymentStatus: 'CONFIRMED', paymentConfirmedAt: new Date(), paymentConfirmedById: userId },
    });
    return changed.count === 1;
  },

  async list(tournamentId: string, query: ListRegistrationsQuery) {
    const where: Prisma.RegistrationWhereInput = {
      tournamentId,
      // Por omisión solo cuentan las activas; las canceladas se piden con status o includeInactive
      ...(query.status ? { status: query.status } : query.includeInactive ? {} : { status: 'ACTIVE' }),
      ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    };
    const [rows, total] = await prisma.$transaction([
      prisma.registration.findMany({
        where,
        include: withPlayer,
        orderBy: [{ [query.sortBy]: query.order }, { id: 'asc' }],
        ...toSkipTake(query.page, query.limit),
      }),
      prisma.registration.count({ where }),
    ]);
    return { rows, total };
  },

  findLink(tournamentId: string, categoryId: string) {
    return prisma.tournamentCategory.findUnique({
      where: { tournamentId_categoryId: { tournamentId, categoryId } },
      include: { category: true },
    });
  },

  findPlayer(id: string) {
    return prisma.player.findUnique({ where: { id }, select: { id: true, status: true, birthDate: true } });
  },
};
