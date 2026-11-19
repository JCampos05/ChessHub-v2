import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { bearer, grantScopedRole, sessionWithRole } from '../helpers/auth.js';
import { prisma, resetDb } from '../helpers/db.js';
import { makeRound } from '../helpers/factories.js';
import { enrollPlayers, makeManualRound, makeTournamentWithCategory } from '../helpers/registrations.js';

const app = createApp();
const MISSING = '0190aaaa-0000-7000-8000-000000000099';

type Status = 'REGISTRATION_OPEN' | 'REGISTRATION_CLOSED' | 'IN_PROGRESS' | 'ROUND_IN_PROGRESS' | 'FINISHED' | 'CANCELLED';

interface RouteCase {
  name: string;
  path: string;
  body: object;
  from: Status;
  expected: Status;
  // Deja el torneo en las condiciones que exige la transición
  prepare?: (tournamentId: string, players: { id: string }[]) => Promise<void>;
}

// Las siete rutas de cambio de estado, cada una con un torneo en el que su transición es válida
const ROUTES: RouteCase[] = [
  { name: 'estado', path: 'estado', body: { estado: 'REGISTRATION_CLOSED' }, from: 'REGISTRATION_OPEN', expected: 'REGISTRATION_CLOSED' },
  { name: 'convocatoria', path: 'convocatoria', body: {}, from: 'REGISTRATION_CLOSED', expected: 'REGISTRATION_OPEN' },
  { name: 'inscripciones_cerradas', path: 'inscripciones_cerradas', body: {}, from: 'REGISTRATION_OPEN', expected: 'REGISTRATION_CLOSED' },
  { name: 'en_juego', path: 'en_juego', body: {}, from: 'REGISTRATION_CLOSED', expected: 'IN_PROGRESS' },
  {
    name: 'ronda_en_curso',
    path: 'ronda_en_curso',
    body: {},
    from: 'IN_PROGRESS',
    expected: 'ROUND_IN_PROGRESS',
    prepare: async (id, players) => makeManualRound(id, players[0]!.id, players[1]!.id),
  },
  {
    name: 'finalizado',
    path: 'finalizado',
    body: {},
    from: 'IN_PROGRESS',
    expected: 'FINISHED',
    prepare: async (id) => {
      await makeRound(id, 1, { status: 'FINISHED', startedAt: new Date(), finishedAt: new Date() });
    },
  },
  { name: 'cancelado', path: 'cancelado', body: { motivo: 'Sede no disponible' }, from: 'REGISTRATION_OPEN', expected: 'CANCELLED' },
];

describe('aislamiento de ámbito y permisos (RF19, RF20, RF23, C-11)', () => {
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const patch = (token: string, tournamentId: string, path: string, body: object) =>
    request(app).patch(`/api/v1/torneos/${tournamentId}/${path}`).set(...bearer(token)).send(body);
  const statusOf = async (id: string) => (await prisma.tournament.findUniqueOrThrow({ where: { id } })).status;

  async function tournamentFor(route: RouteCase) {
    const { tournament, category } = await makeTournamentWithCategory({ status: route.from });
    const players = await enrollPlayers(tournament.id, category.id, 4);
    await route.prepare?.(tournament.id, players);
    return tournament;
  }

  describe.each(ROUTES)('PATCH /torneos/:id/$name', (route) => {
    it('401 sin token', async () => {
      await request(app).patch(`/api/v1/torneos/${MISSING}/${route.path}`).send(route.body).expect(401);
    });

    it('403 para un usuario sin rol, aunque el id sea inválido, y para un árbitro de mesa', async () => {
      const tournament = await tournamentFor(route);
      const none = await sessionWithRole(app);
      const arbiter = await sessionWithRole(app, 'ARBITER');

      await patch(none.token, 'no-es-uuid', route.path, route.body).expect(403);
      await patch(none.token, tournament.id, route.path, route.body).expect(403);
      await patch(arbiter.token, tournament.id, route.path, route.body).expect(403);
      expect(await statusOf(tournament.id)).toBe(route.from);
    });

    it('404 con un id mal formado o inexistente', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');

      await patch(token, 'no-es-uuid', route.path, route.body).expect(404);
      await patch(token, MISSING, route.path, route.body).expect(404);
    });

    it('un organizador del torneo A recibe 200 en el A y 403 OUT_OF_SCOPE en el B, que no cambia', async () => {
      const a = await tournamentFor(route);
      const b = await tournamentFor(route);
      const organizer = await sessionWithRole(app);
      await grantScopedRole(organizer.user.id, 'ORGANIZER', 'TOURNAMENT', a.id);

      const denied = await patch(organizer.token, b.id, route.path, route.body).expect(403);
      expect(denied.body.code).toBe('OUT_OF_SCOPE');
      expect(await statusOf(b.id)).toBe(route.from);

      await patch(organizer.token, a.id, route.path, route.body).expect(200);
      expect(await statusOf(a.id)).toBe(route.expected);
    });
  });

  describe('notificaciones de otro usuario', () => {
    it('el usuario B no las lee, no las cuenta ni las marca', async () => {
      const owner = await sessionWithRole(app);
      const stranger = await sessionWithRole(app);
      const row = await prisma.notification.create({
        data: {
          userId: owner.user.id,
          type: 'TOURNAMENT_STATE_CHANGED',
          title: 'Aviso',
          body: 'El torneo cambió de estado',
          dedupeKey: 'aislamiento:1',
        },
      });

      const list = await request(app).get('/api/v1/notificaciones').set(...bearer(stranger.token)).expect(200);
      const count = await request(app).get('/api/v1/notificaciones/unread-count').set(...bearer(stranger.token)).expect(200);
      await request(app).patch(`/api/v1/notificaciones/${row.id}/leida`).set(...bearer(stranger.token)).expect(404);
      const all = await request(app).patch('/api/v1/notificaciones/leer-todas').set(...bearer(stranger.token)).expect(200);

      expect(list.body.data).toEqual([]);
      expect(count.body).toEqual({ count: 0 });
      expect(all.body).toEqual({ updated: 0 });
      const stored = await prisma.notification.findUniqueOrThrow({ where: { id: row.id } });
      expect(stored.readAt).toBeNull();
    });

    it('401 sin token en las cuatro rutas', async () => {
      await request(app).get('/api/v1/notificaciones').expect(401);
      await request(app).get('/api/v1/notificaciones/unread-count').expect(401);
      await request(app).patch(`/api/v1/notificaciones/${MISSING}/leida`).expect(401);
      await request(app).patch('/api/v1/notificaciones/leer-todas').expect(401);
    });
  });
});
