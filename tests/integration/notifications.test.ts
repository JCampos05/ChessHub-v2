import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { closeNotificationQueue, getNotificationQueue } from '../../src/lib/queue.js';
import type { MemoryNotificationQueue } from '../../src/lib/queue-memory.js';
import { startNotificationConsumer } from '../../src/modules/notifications/notification.consumer.js';
import { bearer, grantScopedRole, sessionWithRole } from '../helpers/auth.js';
import { prisma, resetDb } from '../helpers/db.js';
import { makeTournament } from '../helpers/factories.js';

const app = createApp();
const MISSING = '0190aaaa-0000-7000-8000-000000000099';

describe('bandeja de notificaciones (RF22, RF23)', () => {
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  let sequence = 0;
  // Inserta una notificación con fecha creciente para que el orden sea determinista
  async function notify(userId: string, overrides: { readAt?: Date | null; title?: string } = {}) {
    sequence += 1;
    return prisma.notification.create({
      data: {
        userId,
        type: 'TOURNAMENT_STATE_CHANGED',
        title: overrides.title ?? `Aviso ${sequence}`,
        body: 'El torneo cambió de estado',
        data: { tournamentId: MISSING },
        dedupeKey: `prueba:${sequence}`,
        readAt: overrides.readAt ?? null,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
      },
    });
  }

  const list = (token: string, query = '') => request(app).get(`/api/v1/notificaciones${query}`).set(...bearer(token));
  const unread = (token: string) => request(app).get('/api/v1/notificaciones/unread-count').set(...bearer(token));
  const markRead = (token: string, id: string) =>
    request(app).patch(`/api/v1/notificaciones/${id}/leida`).set(...bearer(token));
  const markAll = (token: string) => request(app).patch('/api/v1/notificaciones/leer-todas').set(...bearer(token));

  describe('GET /notificaciones', () => {
    it('401 sin token', async () => {
      await request(app).get('/api/v1/notificaciones').expect(401);
      await request(app).get('/api/v1/notificaciones/unread-count').expect(401);
    });

    it('bandeja vacía: data vacío con meta y contador en 0', async () => {
      const { token } = await sessionWithRole(app);

      const res = await list(token).expect(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta).toMatchObject({ page: 1, total: 0 });
      expect((await unread(token).expect(200)).body).toEqual({ count: 0 });
    });

    it('lista solo las propias, de la más reciente a la más antigua, sin datos internos', async () => {
      const mine = await sessionWithRole(app);
      const other = await sessionWithRole(app);
      const first = await notify(mine.user.id);
      const second = await notify(mine.user.id);
      await notify(other.user.id);

      const res = await list(mine.token).expect(200);

      expect(res.body.data.map((n: { id: string }) => n.id)).toEqual([second.id, first.id]);
      expect(res.body.meta.total).toBe(2);
      expect(Object.keys(res.body.data[0]).sort()).toEqual(['body', 'createdAt', 'data', 'id', 'readAt', 'title', 'type']);
    });

    it('pagina con page y limit', async () => {
      const { token, user } = await sessionWithRole(app);
      for (let i = 0; i < 3; i += 1) await notify(user.id);

      const res = await list(token, '?page=2&limit=2').expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta).toMatchObject({ page: 2, limit: 2, total: 3, totalPages: 2 });
    });

    it('leida=true y leida=false filtran por estado de lectura', async () => {
      const { token, user } = await sessionWithRole(app);
      const read = await notify(user.id, { readAt: new Date() });
      const pending = await notify(user.id);

      const onlyRead = await list(token, '?leida=true').expect(200);
      const onlyPending = await list(token, '?leida=false').expect(200);

      expect(onlyRead.body.data.map((n: { id: string }) => n.id)).toEqual([read.id]);
      expect(onlyPending.body.data.map((n: { id: string }) => n.id)).toEqual([pending.id]);
    });

    it('422 con leida inválido o page=0', async () => {
      const { token } = await sessionWithRole(app);

      await list(token, '?leida=quizas').expect(422);
      const res = await list(token, '?page=0').expect(422);
      expect(res.body.code).toBeDefined();
    });
  });

  describe('GET /notificaciones/unread-count', () => {
    it('cuenta las no leídas, coincide con la bandeja y no se confunde con un :id', async () => {
      const { token, user } = await sessionWithRole(app);
      await notify(user.id);
      await notify(user.id);
      await notify(user.id, { readAt: new Date() });

      const count = (await unread(token).expect(200)).body.count;
      const pending = (await list(token, '?leida=false').expect(200)).body.meta.total;

      expect(count).toBe(2);
      expect(count).toBe(pending);
    });

    it('no cuenta las de otro usuario', async () => {
      const mine = await sessionWithRole(app);
      const other = await sessionWithRole(app);
      await notify(other.user.id);
      await notify(other.user.id);

      expect((await unread(mine.token).expect(200)).body).toEqual({ count: 0 });
      expect((await unread(other.token).expect(200)).body).toEqual({ count: 2 });
    });
  });

  describe('PATCH /notificaciones/:id/leida', () => {
    it('401 sin token', async () => {
      await request(app).patch(`/api/v1/notificaciones/${MISSING}/leida`).expect(401);
    });

    it('la marca como leída y baja el contador', async () => {
      const { token, user } = await sessionWithRole(app);
      const row = await notify(user.id);

      const res = await markRead(token, row.id).expect(200);

      expect(res.body.id).toBe(row.id);
      expect(res.body.readAt).not.toBeNull();
      expect((await unread(token).expect(200)).body.count).toBe(0);
    });

    it('es idempotente: repetirla no cambia la fecha de lectura', async () => {
      const { token, user } = await sessionWithRole(app);
      const row = await notify(user.id);

      const first = (await markRead(token, row.id).expect(200)).body.readAt;
      const second = (await markRead(token, row.id).expect(200)).body.readAt;

      expect(second).toBe(first);
    });

    it('404 con una inexistente o un id mal formado', async () => {
      const { token } = await sessionWithRole(app);

      await markRead(token, MISSING).expect(404);
      await markRead(token, 'no-es-uuid').expect(404);
    });

    it('404 con una ajena, y la ajena queda sin tocar', async () => {
      const mine = await sessionWithRole(app);
      const other = await sessionWithRole(app);
      const foreign = await notify(other.user.id);

      await markRead(mine.token, foreign.id).expect(404);

      const stored = await prisma.notification.findUniqueOrThrow({ where: { id: foreign.id } });
      expect(stored.readAt).toBeNull();
    });
  });

  describe('PATCH /notificaciones/leer-todas', () => {
    it('401 sin token', async () => {
      await request(app).patch('/api/v1/notificaciones/leer-todas').expect(401);
    });

    it('marca solo las propias pendientes, devuelve { updated } y deja el contador en 0', async () => {
      const mine = await sessionWithRole(app);
      const other = await sessionWithRole(app);
      await notify(mine.user.id);
      await notify(mine.user.id);
      await notify(mine.user.id, { readAt: new Date() });
      await notify(other.user.id);

      const res = await markAll(mine.token).expect(200);

      expect(res.body).toEqual({ updated: 2 });
      expect((await unread(mine.token).expect(200)).body.count).toBe(0);
      expect((await unread(other.token).expect(200)).body.count).toBe(1);
    });

    it('sin pendientes devuelve { updated: 0 }', async () => {
      const { token } = await sessionWithRole(app);

      expect((await markAll(token).expect(200)).body).toEqual({ updated: 0 });
    });

    it('responde igual en el alias en inglés', async () => {
      const { token, user } = await sessionWithRole(app);
      await notify(user.id);

      const res = await request(app).patch('/api/v1/notifications/read-all').set(...bearer(token)).expect(200);

      expect(res.body).toEqual({ updated: 1 });
    });
  });

  describe('consumidor de la cola (RF22, RNF06)', () => {
    beforeEach(async () => {
      await closeNotificationQueue();
      await startNotificationConsumer();
    });
    afterAll(closeNotificationQueue);

    const queue = () => getNotificationQueue() as MemoryNotificationQueue;
    const close = (token: string, tournamentId: string) =>
      request(app)
        .patch(`/api/v1/torneos/${tournamentId}/estado`)
        .set(...bearer(token))
        .send({ estado: 'REGISTRATION_CLOSED' });
    const countFor = (userId: string) => prisma.notification.count({ where: { userId } });

    it('avisa al creador y a quien tiene un rol con ámbito del torneo, y a nadie más', async () => {
      const creator = await sessionWithRole(app);
      const organizer = await sessionWithRole(app);
      const unrelated = await sessionWithRole(app);
      const actor = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const tournament = await makeTournament({ status: 'REGISTRATION_OPEN', createdById: creator.user.id });
      await grantScopedRole(organizer.user.id, 'ORGANIZER', 'TOURNAMENT', tournament.id);

      await close(actor.token, tournament.id).expect(200);
      await queue().drain();

      expect(await countFor(creator.user.id)).toBe(1);
      expect(await countFor(organizer.user.id)).toBe(1);
      expect(await countFor(unrelated.user.id)).toBe(0);
      expect(await countFor(actor.user.id)).toBe(0);
      expect(queue().failed()).toEqual([]);

      const inbox = await list(creator.token).expect(200);
      expect(inbox.body.data).toHaveLength(1);
      expect(inbox.body.data[0].data).toMatchObject({ tournamentId: tournament.id });
    });

    it('incluye al actor cuando también es el creador del torneo', async () => {
      const actor = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const tournament = await makeTournament({ status: 'REGISTRATION_OPEN', createdById: actor.user.id });

      await close(actor.token, tournament.id).expect(200);
      await queue().drain();

      expect(await countFor(actor.user.id)).toBe(1);
    });
  });
});
