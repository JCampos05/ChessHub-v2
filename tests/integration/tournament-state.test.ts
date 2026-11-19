import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { getNotificationQueue } from '../../src/lib/queue.js';
import { bearer, grantScopedRole, sessionWithRole } from '../helpers/auth.js';
import { prisma, resetDb } from '../helpers/db.js';
import { makeRound } from '../helpers/factories.js';
import { enrollPlayers, finishRoundGames, makeTournamentWithCategory } from '../helpers/registrations.js';

const app = createApp();
const MISSING = '0190aaaa-0000-7000-8000-000000000099';

type Status = 'REGISTRATION_OPEN' | 'REGISTRATION_CLOSED' | 'IN_PROGRESS' | 'ROUND_IN_PROGRESS' | 'FINISHED' | 'CANCELLED';

describe('cambios de estado del torneo (RF19, RF20, RF21, RN-04)', () => {
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const patch = (token: string, tournamentId: string, path: string, body?: object) => {
    const req = request(app).patch(`/api/v1/torneos/${tournamentId}/${path}`).set(...bearer(token));
    return body === undefined ? req : req.send(body);
  };
  const setState = (token: string, tournamentId: string, estado: string | number, motivo?: string) =>
    patch(token, tournamentId, 'estado', { estado, ...(motivo === undefined ? {} : { motivo }) });
  const generate = (token: string, tournamentId: string) =>
    request(app).post(`/api/v1/torneos/${tournamentId}/rondas/generar`).set(...bearer(token)).send({});
  const history = (token: string, tournamentId: string, query = '') =>
    request(app).get(`/api/v1/torneos/${tournamentId}/historial-estados${query}`).set(...bearer(token));
  const admin = () => sessionWithRole(app, 'FEDERATION_ADMIN');

  async function tournamentIn(status: Status, players = 4, overrides: { roundsPlanned?: number } = {}) {
    const { tournament, category } = await makeTournamentWithCategory({ status, ...overrides });
    const enrolled = players > 0 ? await enrollPlayers(tournament.id, category.id, players) : [];
    return { tournament, category, enrolled };
  }
  const statusOf = async (id: string) => (await prisma.tournament.findUniqueOrThrow({ where: { id } })).status;

  describe('PATCH /torneos/:id/estado', () => {
    it('401 sin token', async () => {
      await request(app).patch(`/api/v1/torneos/${MISSING}/estado`).send({ estado: 'IN_PROGRESS' }).expect(401);
    });

    it('403 sin rol y con un rol que no actualiza torneos', async () => {
      const { tournament } = await tournamentIn('REGISTRATION_OPEN');
      const none = await sessionWithRole(app);
      const chief = await sessionWithRole(app, 'CHIEF_ARBITER');

      await setState(none.token, tournament.id, 'REGISTRATION_CLOSED').expect(403);
      await setState(chief.token, tournament.id, 'REGISTRATION_CLOSED').expect(403);
      expect(await statusOf(tournament.id)).toBe('REGISTRATION_OPEN');
    });

    it('403 OUT_OF_SCOPE con un rol limitado a otro torneo', async () => {
      const mine = await tournamentIn('REGISTRATION_OPEN');
      const other = await tournamentIn('REGISTRATION_OPEN');
      const { token, user } = await sessionWithRole(app);
      await grantScopedRole(user.id, 'ORGANIZER', 'TOURNAMENT', mine.tournament.id);

      await setState(token, mine.tournament.id, 'REGISTRATION_CLOSED').expect(200);
      const res = await setState(token, other.tournament.id, 'REGISTRATION_CLOSED').expect(403);

      expect(res.body.code).toBe('OUT_OF_SCOPE');
      expect(await statusOf(other.tournament.id)).toBe('REGISTRATION_OPEN');
    });

    it('404 con un id mal formado o inexistente', async () => {
      const { token } = await admin();
      await setState(token, 'no-es-uuid', 'REGISTRATION_CLOSED').expect(404);
      await setState(token, MISSING, 'REGISTRATION_CLOSED').expect(404);
    });

    it('200 con el torneo actualizado y una fila de historial con actor y motivo', async () => {
      const { tournament } = await tournamentIn('REGISTRATION_OPEN');
      const { token, user } = await admin();

      const res = await setState(token, tournament.id, 'REGISTRATION_CLOSED', 'Cupo completo').expect(200);

      expect(res.body).toMatchObject({ id: tournament.id, status: 'REGISTRATION_CLOSED' });
      const rows = await prisma.stateChange.findMany({ where: { entityId: tournament.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        entityType: 'TOURNAMENT',
        fromState: 'REGISTRATION_OPEN',
        toState: 'REGISTRATION_CLOSED',
        changedById: user.id,
        reason: 'Cupo completo',
      });
    });

    it.each(['REGISTRATION_CLOSED', 'inscripciones_cerradas', 'Inscripciones_Cerradas', 2, '2'])(
      'el estado acepta código, nombre y número: %s',
      async (estado) => {
        const { tournament } = await tournamentIn('REGISTRATION_OPEN');
        const { token } = await admin();

        const res = await setState(token, tournament.id, estado).expect(200);

        expect(res.body.status).toBe('REGISTRATION_CLOSED');
      },
    );

    it('acepta el alias /status con las claves status y reason', async () => {
      const { tournament } = await tournamentIn('REGISTRATION_OPEN');
      const { token } = await admin();

      await request(app)
        .patch(`/api/v1/torneos/${tournament.id}/status`)
        .set(...bearer(token))
        .send({ status: 'CANCELLED', reason: 'Sede no disponible' })
        .expect(200);

      const row = await prisma.stateChange.findFirstOrThrow({ where: { entityId: tournament.id } });
      expect(row.reason).toBe('Sede no disponible');
    });

    it('400 con un estado desconocido (CONFIRMADO) y no cambia nada', async () => {
      const { tournament } = await tournamentIn('REGISTRATION_OPEN');
      const { token } = await admin();

      const res = await setState(token, tournament.id, 'CONFIRMADO').expect(400);

      expect(res.body.errors[0].field).toBe('estado');
      expect(await statusOf(tournament.id)).toBe('REGISTRATION_OPEN');
      expect(await prisma.stateChange.count()).toBe(0);
    });

    it('400 con el cuerpo vacío, un tipo inválido o un motivo de más de 500 caracteres', async () => {
      const { tournament } = await tournamentIn('REGISTRATION_OPEN');
      const { token } = await admin();

      await patch(token, tournament.id, 'estado', {}).expect(400);
      await patch(token, tournament.id, 'estado', { estado: true }).expect(400);
      await patch(token, tournament.id, 'estado', { estado: 7 }).expect(400);
      await setState(token, tournament.id, 'CANCELLED', 'x'.repeat(501)).expect(400);
      expect(await statusOf(tournament.id)).toBe('REGISTRATION_OPEN');
    });

    it('422 INVALID_STATE_TRANSITION con una transición que no existe y no cambia nada', async () => {
      const { tournament } = await tournamentIn('REGISTRATION_OPEN');
      const { token } = await admin();

      const skip = await setState(token, tournament.id, 'IN_PROGRESS').expect(422);
      const same = await setState(token, tournament.id, 'REGISTRATION_OPEN').expect(422);

      expect(skip.body.code).toBe('INVALID_STATE_TRANSITION');
      expect(same.body.code).toBe('INVALID_STATE_TRANSITION');
      expect(await statusOf(tournament.id)).toBe('REGISTRATION_OPEN');
      expect(await prisma.stateChange.count()).toBe(0);
    });

    it.each(['FINISHED', 'CANCELLED'] as const)('422 INVALID_STATE_TRANSITION desde el estado final %s', async (status) => {
      const { tournament } = await tournamentIn(status);
      const { token } = await admin();

      const res = await setState(token, tournament.id, 'REGISTRATION_OPEN').expect(422);

      expect(res.body.code).toBe('INVALID_STATE_TRANSITION');
      expect(res.body.message).toMatch(/estado final/);
    });

    it('422 STATE_PRECONDITION_FAILED al iniciar con menos de 2 inscripciones activas', async () => {
      const { tournament } = await tournamentIn('REGISTRATION_CLOSED', 1);
      const { token } = await admin();

      const res = await setState(token, tournament.id, 'IN_PROGRESS').expect(422);

      expect(res.body).toMatchObject({ statusCode: 422, code: 'STATE_PRECONDITION_FAILED' });
      expect(res.body.message).toMatch(/al menos 2 inscripciones/);
      expect(await statusOf(tournament.id)).toBe('REGISTRATION_CLOSED');
    });

    it('422 STATE_PRECONDITION_FAILED al poner la ronda en curso sin ronda, o con una ronda sin mesas', async () => {
      const { tournament } = await tournamentIn('IN_PROGRESS');
      const { token } = await admin();

      const none = await setState(token, tournament.id, 'ROUND_IN_PROGRESS').expect(422);
      expect(none.body.code).toBe('STATE_PRECONDITION_FAILED');
      expect(none.body.message).toMatch(/genera la ronda/);

      await makeRound(tournament.id, 1);
      const empty = await setState(token, tournament.id, 'ROUND_IN_PROGRESS').expect(422);
      expect(empty.body.message).toMatch(/no tiene mesas/);
    });

    it('422 STATE_PRECONDITION_FAILED al cerrar la ronda con partidas pendientes y 200 cuando ya tienen resultado', async () => {
      const { tournament } = await tournamentIn('IN_PROGRESS');
      const { token } = await admin();
      await generate(token, tournament.id).expect(201);
      await setState(token, tournament.id, 'ROUND_IN_PROGRESS').expect(200);

      const res = await setState(token, tournament.id, 'IN_PROGRESS').expect(422);
      expect(res.body.code).toBe('STATE_PRECONDITION_FAILED');
      expect(res.body.message).toMatch(/2 partidas pendientes/);
      expect(await statusOf(tournament.id)).toBe('ROUND_IN_PROGRESS');

      await finishRoundGames(tournament.id, 1);
      await setState(token, tournament.id, 'IN_PROGRESS').expect(200);
    });

    it('422 STATE_PRECONDITION_FAILED al finalizar sin rondas terminadas, con ronda abierta o con rondas planeadas faltantes', async () => {
      const { tournament } = await tournamentIn('IN_PROGRESS', 4, { roundsPlanned: 2 });
      const { token } = await admin();

      const none = await setState(token, tournament.id, 'FINISHED').expect(422);
      expect(none.body.message).toMatch(/ninguna ronda terminada/);

      await generate(token, tournament.id).expect(201);
      const open = await setState(token, tournament.id, 'FINISHED').expect(422);
      expect(open.body.message).toMatch(/ronda sin terminar/);

      await setState(token, tournament.id, 'ROUND_IN_PROGRESS').expect(200);
      await finishRoundGames(tournament.id, 1);
      await setState(token, tournament.id, 'IN_PROGRESS').expect(200);
      const missing = await setState(token, tournament.id, 'FINISHED').expect(422);
      expect(missing.body.message).toMatch(/1 de 2 rondas planeadas/);
    });

    it('con rounds_planned nulo basta una ronda terminada para finalizar', async () => {
      const { tournament } = await tournamentIn('IN_PROGRESS');
      const { token } = await admin();
      await generate(token, tournament.id).expect(201);
      await setState(token, tournament.id, 'ROUND_IN_PROGRESS').expect(200);
      await finishRoundGames(tournament.id, 1);
      await setState(token, tournament.id, 'IN_PROGRESS').expect(200);

      await setState(token, tournament.id, 'FINISHED').expect(200);
    });

    it('un torneo dado de baja responde 404', async () => {
      const { tournament } = await tournamentIn('REGISTRATION_OPEN');
      await prisma.tournament.update({ where: { id: tournament.id }, data: { isActive: false } });
      const { token } = await admin();

      await setState(token, tournament.id, 'REGISTRATION_CLOSED').expect(404);
    });

    it('el detalle cacheado del torneo refleja el nuevo estado', async () => {
      const { tournament } = await tournamentIn('REGISTRATION_OPEN');
      const { token } = await admin();
      const detail = () => request(app).get(`/api/v1/torneos/${tournament.id}`).set(...bearer(token));

      expect((await detail().expect(200)).body.status).toBe('REGISTRATION_OPEN');
      await setState(token, tournament.id, 'REGISTRATION_CLOSED').expect(200);

      expect((await detail().expect(200)).body.status).toBe('REGISTRATION_CLOSED');
    });

    it('encola un trabajo con el cambio y el torneo', async () => {
      const { tournament } = await tournamentIn('REGISTRATION_OPEN');
      const { token } = await admin();
      const enqueue = vi.spyOn(getNotificationQueue(), 'enqueue');

      try {
        await setState(token, tournament.id, 'REGISTRATION_CLOSED').expect(200);

        const change = await prisma.stateChange.findFirstOrThrow({ where: { entityId: tournament.id } });
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(enqueue).toHaveBeenCalledWith({ changeId: change.id, tournamentId: tournament.id });
      } finally {
        enqueue.mockRestore();
      }
    });

    it('un rechazo no encola nada', async () => {
      const { tournament } = await tournamentIn('REGISTRATION_OPEN');
      const { token } = await admin();
      const enqueue = vi.spyOn(getNotificationQueue(), 'enqueue');

      try {
        await setState(token, tournament.id, 'FINISHED').expect(422);
        expect(enqueue).not.toHaveBeenCalled();
      } finally {
        enqueue.mockRestore();
      }
    });

    it('503 QUEUE_UNAVAILABLE si la cola falla: el estado no cambia y no queda historial', async () => {
      const { tournament } = await tournamentIn('REGISTRATION_OPEN');
      const { token } = await admin();
      const enqueue = vi.spyOn(getNotificationQueue(), 'enqueue').mockRejectedValueOnce(new Error('redis caído'));

      try {
        const res = await setState(token, tournament.id, 'REGISTRATION_CLOSED').expect(503);
        expect(res.body.code).toBe('QUEUE_UNAVAILABLE');
      } finally {
        enqueue.mockRestore();
      }

      expect(await statusOf(tournament.id)).toBe('REGISTRATION_OPEN');
      expect(await prisma.stateChange.count()).toBe(0);
      await setState(token, tournament.id, 'REGISTRATION_CLOSED').expect(200);
    });
  });

  describe('rutas por nombre', () => {
    it('ciclo completo con una fila de historial por paso y las fechas de la ronda', async () => {
      const { tournament } = await tournamentIn('REGISTRATION_OPEN', 4, { roundsPlanned: 1 });
      const { token } = await admin();

      await patch(token, tournament.id, 'inscripciones_cerradas', {}).expect(200);
      await patch(token, tournament.id, 'en_juego').expect(200);
      await generate(token, tournament.id).expect(201);
      const running = await patch(token, tournament.id, 'ronda_en_curso', {}).expect(200);
      expect(running.body.status).toBe('ROUND_IN_PROGRESS');
      const started = await prisma.round.findUniqueOrThrow({
        where: { tournamentId_number: { tournamentId: tournament.id, number: 1 } },
      });
      expect(started).toMatchObject({ status: 'IN_PROGRESS', finishedAt: null });
      expect(started.startedAt).toBeTruthy();

      await finishRoundGames(tournament.id, 1);
      await patch(token, tournament.id, 'en_juego', {}).expect(200);
      const finished = await prisma.round.findUniqueOrThrow({
        where: { tournamentId_number: { tournamentId: tournament.id, number: 1 } },
      });
      expect(finished.status).toBe('FINISHED');
      expect(finished.finishedAt).toBeTruthy();

      const last = await patch(token, tournament.id, 'finalizado', {}).expect(200);
      expect(last.body.status).toBe('FINISHED');

      const rows = await prisma.stateChange.findMany({ where: { entityId: tournament.id }, orderBy: { createdAt: 'asc' } });
      expect(rows.map((r) => `${r.fromState}>${r.toState}`)).toEqual([
        'REGISTRATION_OPEN>REGISTRATION_CLOSED',
        'REGISTRATION_CLOSED>IN_PROGRESS',
        'IN_PROGRESS>ROUND_IN_PROGRESS',
        'ROUND_IN_PROGRESS>IN_PROGRESS',
        'IN_PROGRESS>FINISHED',
      ]);
    });

    it('/convocatoria reabre las inscripciones cerradas', async () => {
      const { tournament } = await tournamentIn('REGISTRATION_CLOSED');
      const { token } = await admin();

      const res = await patch(token, tournament.id, 'convocatoria', {}).expect(200);

      expect(res.body.status).toBe('REGISTRATION_OPEN');
    });

    it('una ronda manual pendiente pasa a en curso con su fecha de inicio', async () => {
      const { tournament, enrolled } = await tournamentIn('IN_PROGRESS');
      const { token } = await admin();
      await makeRound(tournament.id, 1);
      await prisma.pairing.create({
        data: {
          tournamentId: tournament.id,
          roundNumber: 1,
          board: 1,
          whitePlayerId: enrolled[0]!.id,
          blackPlayerId: enrolled[1]!.id,
          game: {
            create: {
              tournamentId: tournament.id,
              roundNumber: 1,
              whitePlayerId: enrolled[0]!.id,
              blackPlayerId: enrolled[1]!.id,
            },
          },
        },
      });

      await patch(token, tournament.id, 'ronda_en_curso', {}).expect(200);

      const round = await prisma.round.findUniqueOrThrow({
        where: { tournamentId_number: { tournamentId: tournament.id, number: 1 } },
      });
      expect(round.status).toBe('IN_PROGRESS');
      expect(round.startedAt).toBeTruthy();
    });

    it('/cancelado guarda el motivo y las demás rutas lo ignoran', async () => {
      const closed = await tournamentIn('REGISTRATION_OPEN');
      const cancelled = await tournamentIn('REGISTRATION_OPEN');
      const { token } = await admin();

      await patch(token, closed.tournament.id, 'inscripciones_cerradas', { motivo: 'no se guarda' }).expect(200);
      await patch(token, cancelled.tournament.id, 'cancelado', { motivo: 'Lluvia' }).expect(200);

      const closedRow = await prisma.stateChange.findFirstOrThrow({ where: { entityId: closed.tournament.id } });
      const cancelledRow = await prisma.stateChange.findFirstOrThrow({ where: { entityId: cancelled.tournament.id } });
      expect(closedRow.reason).toBeNull();
      expect(cancelledRow.reason).toBe('Lluvia');
    });

    it.each(['REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS', 'ROUND_IN_PROGRESS'] as const)(
      'cancelar desde %s responde 200',
      async (status) => {
        const { tournament } = await tournamentIn(status);
        const { token } = await admin();

        const res = await patch(token, tournament.id, 'cancelado').expect(200);

        expect(res.body.status).toBe('CANCELLED');
      },
    );

    it.each(['FINISHED', 'CANCELLED'] as const)('cancelar desde el estado final %s responde 422', async (status) => {
      const { tournament } = await tournamentIn(status);
      const { token } = await admin();

      const res = await patch(token, tournament.id, 'cancelado').expect(422);

      expect(res.body.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('cada ruta respeta la autenticación y los permisos', async () => {
      const { tournament } = await tournamentIn('REGISTRATION_OPEN');
      const { token } = await sessionWithRole(app, 'CHIEF_ARBITER');

      await request(app).patch(`/api/v1/torneos/${tournament.id}/en_juego`).expect(401);
      await patch(token, tournament.id, 'cancelado', {}).expect(403);
      await patch(token, 'no-es-uuid', 'cancelado', {}).expect(403);
      const { token: allowed } = await admin();
      await patch(allowed, 'no-es-uuid', 'cancelado', {}).expect(404);
    });
  });

  describe('GET /torneos/:id/historial-estados', () => {
    async function cycle() {
      const { tournament } = await tournamentIn('REGISTRATION_OPEN');
      const { token, user } = await admin();
      await patch(token, tournament.id, 'inscripciones_cerradas', {}).expect(200);
      await patch(token, tournament.id, 'convocatoria', {}).expect(200);
      await patch(token, tournament.id, 'cancelado', { motivo: 'Lluvia' }).expect(200);
      return { tournament, token, user };
    }

    it('devuelve las transiciones del ciclo, de la más reciente a la más antigua', async () => {
      const { tournament, token, user } = await cycle();

      const res = await history(token, tournament.id).expect(200);

      expect(res.body.meta).toMatchObject({ page: 1, total: 3 });
      expect(res.body.data.map((c: { from: string; to: string }) => `${c.from}>${c.to}`)).toEqual([
        'REGISTRATION_OPEN>CANCELLED',
        'REGISTRATION_CLOSED>REGISTRATION_OPEN',
        'REGISTRATION_OPEN>REGISTRATION_CLOSED',
      ]);
      expect(res.body.data[0]).toMatchObject({
        entityType: 'TOURNAMENT',
        entityId: tournament.id,
        changedById: user.id,
        reason: 'Lluvia',
      });
      expect(res.body.data[0].createdAt).toBeTruthy();
    });

    it('pagina el historial', async () => {
      const { tournament, token } = await cycle();

      const res = await history(token, tournament.id, '?page=2&limit=2').expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta).toMatchObject({ page: 2, limit: 2, total: 3, totalPages: 2 });
    });

    it('422 con page=0 o limit fuera de rango', async () => {
      const { tournament, token } = await cycle();

      await history(token, tournament.id, '?page=0').expect(422);
      await history(token, tournament.id, '?limit=1000').expect(422);
    });

    it('404 con un torneo inexistente o un id mal formado', async () => {
      const { token } = await admin();

      await history(token, MISSING).expect(404);
      await history(token, 'no-es-uuid').expect(404);
    });

    it('401 sin token y lectura permitida a cualquier usuario autenticado', async () => {
      const { tournament } = await cycle();
      const reader = await sessionWithRole(app);

      await request(app).get(`/api/v1/torneos/${tournament.id}/historial-estados`).expect(401);
      const res = await history(reader.token, tournament.id).expect(200);
      expect(res.body.data).toHaveLength(3);
    });

    it('el alias /status-history responde igual y un torneo sin cambios devuelve una lista vacía', async () => {
      const { tournament } = await tournamentIn('REGISTRATION_OPEN');
      const { token } = await admin();

      const res = await request(app)
        .get(`/api/v1/torneos/${tournament.id}/status-history`)
        .set(...bearer(token))
        .expect(200);

      expect(res.body.data).toEqual([]);
      expect(res.body.meta.total).toBe(0);
    });
  });
});
