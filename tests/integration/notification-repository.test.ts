import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { notificationRepository } from '../../src/modules/notifications/notification.repository.js';
import { grantRole, grantScopedRole } from '../helpers/auth.js';
import { prisma, resetDb } from '../helpers/db.js';
import { makeTournament } from '../helpers/factories.js';

// Resolución de destinatarios y marcas de correo contra la base real 
describe('repositorio de notificaciones', () => {
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  let seq = 0;
  const makeUser = (overrides: { isActive?: boolean } = {}) => {
    seq += 1;
    return prisma.user.create({
      data: { email: `destino${seq}@prueba.local`, passwordHash: 'no-se-usa', ...overrides },
    });
  };
  const ids = (users: { id: string }[]) => users.map((u) => u.id).sort();

  describe('findRecipients', () => {
    it('[RF22] incluye al creador y a quienes tienen un rol con ámbito de ese torneo', async () => {
      const creator = await makeUser();
      const chief = await makeUser();
      const organizer = await makeUser();
      const tournament = await makeTournament({ createdById: creator.id });
      await grantScopedRole(chief.id, 'CHIEF_ARBITER', 'TOURNAMENT', tournament.id);
      await grantScopedRole(organizer.id, 'ORGANIZER', 'TOURNAMENT', tournament.id);

      const found = await notificationRepository.findRecipients(tournament);

      expect(ids(found)).toEqual(ids([creator, chief, organizer]));
    });

    it('[RF22] no repite a quien es creador y además tiene rol', async () => {
      const creator = await makeUser();
      const tournament = await makeTournament({ createdById: creator.id });
      await grantScopedRole(creator.id, 'ORGANIZER', 'TOURNAMENT', tournament.id);

      const found = await notificationRepository.findRecipients(tournament);

      expect(found).toHaveLength(1);
    });

    it('[RF22] no incluye roles de otro torneo ni de federación', async () => {
      const creator = await makeUser();
      const other = await makeUser();
      const federation = await makeUser();
      const tournament = await makeTournament({ createdById: creator.id });
      const another = await makeTournament();
      await grantScopedRole(other.id, 'CHIEF_ARBITER', 'TOURNAMENT', another.id);
      await grantRole(federation.id, 'FEDERATION_ADMIN');

      const found = await notificationRepository.findRecipients(tournament);

      expect(ids(found)).toEqual([creator.id]);
    });

    it('[RF22] omite a los usuarios inactivos', async () => {
      const creator = await makeUser({ isActive: false });
      const chief = await makeUser();
      const tournament = await makeTournament({ createdById: creator.id });
      await grantScopedRole(chief.id, 'CHIEF_ARBITER', 'TOURNAMENT', tournament.id);

      const found = await notificationRepository.findRecipients(tournament);

      expect(ids(found)).toEqual([chief.id]);
    });

    it('[RF22] un torneo sin creador solo notifica a quienes tienen rol', async () => {
      const chief = await makeUser();
      const tournament = await makeTournament();
      await grantScopedRole(chief.id, 'CHIEF_ARBITER', 'TOURNAMENT', tournament.id);

      const found = await notificationRepository.findRecipients(tournament);

      expect(ids(found)).toEqual([chief.id]);
    });
  });

  describe('createMany y correos pendientes', () => {
    const row = (userId: string) => ({
      userId,
      type: 'TOURNAMENT_STATE_CHANGED',
      title: 'Torneo «X»: de convocatoria a inscripciones cerradas',
      body: 'Se cerraron las inscripciones.',
      data: { changeId: 'c1' },
      dedupeKey: 'state_change:c1',
    });

    it('[RF22] repetir createMany no duplica filas', async () => {
      const user = await makeUser();

      await notificationRepository.createMany([row(user.id)]);
      await notificationRepository.createMany([row(user.id)]);

      expect(await prisma.notification.count()).toBe(1);
    });

    it('[RF23] findUnsentEmails devuelve solo filas sin enviar de usuarios activos y markEmailed las excluye', async () => {
      const a = await makeUser();
      const b = await makeUser();
      const inactive = await makeUser({ isActive: false });
      await notificationRepository.createMany([row(a.id), row(b.id), row(inactive.id)]);

      const pending = await notificationRepository.findUnsentEmails('state_change:c1');
      expect(pending.map((p) => p.email).sort()).toEqual([a.email, b.email].sort());

      await notificationRepository.markEmailed(pending[0]!.id);

      expect(await notificationRepository.findUnsentEmails('state_change:c1')).toHaveLength(1);
    });
  });
});
