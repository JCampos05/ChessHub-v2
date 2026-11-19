import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';

export interface StateChangeRecord {
  id: string;
  entityId: string;
  fromState: string;
  toState: string;
  reason: string | null;
}

export interface TournamentRecord {
  id: string;
  name: string;
  createdById: string | null;
}

export interface Recipient {
  id: string;
  email: string;
}

export interface NewNotification {
  userId: string;
  type: string;
  title: string;
  body: string;
  data: object;
  dedupeKey: string;
}

export interface UnsentEmail {
  id: string;
  email: string;
  title: string;
  body: string;
}

// Lo que necesita el consumidor de la cola; las pruebas lo sustituyen con una versión en memoria
export interface NotificationWorkerRepository {
  findStateChange(id: string): Promise<StateChangeRecord | null>;
  findTournament(id: string): Promise<TournamentRecord | null>;
  findRecipients(tournament: TournamentRecord): Promise<Recipient[]>;
  createMany(rows: NewNotification[]): Promise<void>;
  findUnsentEmails(dedupeKey: string): Promise<UnsentEmail[]>;
  markEmailed(id: string): Promise<void>;
}

export const notificationRepository = {
  findStateChange(id: string): Promise<StateChangeRecord | null> {
    return prisma.stateChange.findFirst({
      where: { id, entityType: 'TOURNAMENT' },
      select: { id: true, entityId: true, fromState: true, toState: true, reason: true },
    });
  },

  findTournament(id: string): Promise<TournamentRecord | null> {
    return prisma.tournament.findUnique({ where: { id }, select: { id: true, name: true, createdById: true } });
  },

  // Destinatarios (P-45): quien creó el torneo y quienes tienen un rol con ámbito de ese torneo; solo usuarios activos
  findRecipients(tournament: TournamentRecord): Promise<Recipient[]> {
    return prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          ...(tournament.createdById === null ? [] : [{ id: tournament.createdById }]),
          { roles: { some: { scopeType: 'TOURNAMENT' as const, scopeId: tournament.id } } },
        ],
      },
      select: { id: true, email: true },
      orderBy: { createdAt: 'asc' },
    });
  },

  // El único (user_id, dedupe_key) hace idempotente la creación: repetirla no duplica filas
  async createMany(rows: NewNotification[]): Promise<void> {
    if (rows.length === 0) return;
    await prisma.notification.createMany({
      data: rows.map((row) => ({ ...row, data: row.data as Prisma.InputJsonObject })),
      skipDuplicates: true,
    });
  },

  async findUnsentEmails(dedupeKey: string): Promise<UnsentEmail[]> {
    const rows = await prisma.notification.findMany({
      where: { dedupeKey, emailedAt: null, user: { isActive: true } },
      select: { id: true, title: true, body: true, user: { select: { email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({ id: row.id, email: row.user.email, title: row.title, body: row.body }));
  },

  async markEmailed(id: string): Promise<void> {
    await prisma.notification.update({ where: { id }, data: { emailedAt: new Date() } });
  },
} satisfies NotificationWorkerRepository;
