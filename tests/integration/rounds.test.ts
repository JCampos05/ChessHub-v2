import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { bearer, grantScopedRole, sessionWithRole } from '../helpers/auth.js';
import { prisma, resetDb } from '../helpers/db.js';
import { makeRound, makeTournament } from '../helpers/factories.js';

const app = createApp();
const MISSING = '0190aaaa-0000-7000-8000-000000000099';

describe('rondas (RF06, RF08, RNF08)', () => {
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('autenticación y permisos', () => {
    it('401 sin token', async () => {
      await request(app).get('/api/v1/rondas').expect(401);
      await request(app).post('/api/v1/rondas').send({}).expect(401);
      await request(app).get('/api/v1/rondas/1').expect(401);
      await request(app).patch('/api/v1/rondas/1').send({}).expect(401);
      await request(app).delete('/api/v1/rondas/1').expect(401);
    });

    it('un usuario sin rol lee pero no crea (403)', async () => {
      const tournament = await makeTournament();
      const { token } = await sessionWithRole(app);
      await request(app).get('/api/v1/rondas').set(...bearer(token)).expect(200);
      await request(app)
        .post('/api/v1/rondas')
        .set(...bearer(token))
        .send({ tournamentId: tournament.id, number: 1 })
        .expect(403);
    });

    it('un árbitro de mesa no administra rondas (403)', async () => {
      const tournament = await makeTournament();
      const { token } = await sessionWithRole(app, 'ARBITER');
      await request(app)
        .post('/api/v1/rondas')
        .set(...bearer(token))
        .send({ tournamentId: tournament.id, number: 1 })
        .expect(403);
    });

    it('el árbitro principal de un torneo no administra rondas de otro (403 OUT_OF_SCOPE)', async () => {
      const mine = await makeTournament();
      const other = await makeTournament();
      const { token, user } = await sessionWithRole(app);
      await grantScopedRole(user.id, 'CHIEF_ARBITER', 'TOURNAMENT', mine.id);

      await request(app)
        .post('/api/v1/rondas')
        .set(...bearer(token))
        .send({ tournamentId: mine.id, number: 1 })
        .expect(201);
      const res = await request(app)
        .post('/api/v1/rondas')
        .set(...bearer(token))
        .send({ tournamentId: other.id, number: 1 })
        .expect(403);
      expect(res.body.code).toBe('OUT_OF_SCOPE');

      const foreignRound = await makeRound(other.id, 2);
      await request(app).delete(`/api/v1/rondas/${foreignRound.id}`).set(...bearer(token)).expect(403);
    });

    it('id malformado responde 404', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      await request(app).get('/api/v1/rondas/1').set(...bearer(token)).expect(404);
      await request(app).patch('/api/v1/rondas/1').set(...bearer(token)).send({ number: 2 }).expect(404);
      await request(app).delete('/api/v1/rondas/1').set(...bearer(token)).expect(404);
    });
  });

  describe('POST /rondas', () => {
    it('201: crea la ronda pendiente', async () => {
      const tournament = await makeTournament();
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const res = await request(app)
        .post('/api/v1/rondas')
        .set(...bearer(token))
        .send({ tournamentId: tournament.id, number: 1 })
        .expect(201);
      expect(res.body).toMatchObject({ tournamentId: tournament.id, number: 1, status: 'PENDING', isActive: true });
    });

    it('acepta alias en español e ignora el estado enviado', async () => {
      const tournament = await makeTournament();
      const { token } = await sessionWithRole(app, 'SUPER_ADMIN');
      const res = await request(app)
        .post('/api/v1/rondas')
        .set(...bearer(token))
        .send({ torneoId: tournament.id, numero: 2, status: 'FINISHED' })
        .expect(201);
      expect(res.body).toMatchObject({ number: 2, status: 'PENDING' });
    });

    it.each([
      ['cuerpo vacío', {}],
      ['sin número', { tournamentId: MISSING }],
      ['torneo con formato inválido', { tournamentId: 'abc', number: 1 }],
      ['número cero', { tournamentId: MISSING, number: 0 }],
      ['número no numérico', { tournamentId: MISSING, number: 'uno' }],
    ])('400: %s', async (_caso, body) => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const res = await request(app).post('/api/v1/rondas').set(...bearer(token)).send(body).expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('400 REFERENCE_NOT_FOUND: el torneo no existe o está inactivo', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const missing = await request(app)
        .post('/api/v1/rondas')
        .set(...bearer(token))
        .send({ tournamentId: MISSING, number: 1 })
        .expect(400);
      expect(missing.body.code).toBe('REFERENCE_NOT_FOUND');

      const inactive = await makeTournament({ isActive: false });
      await request(app)
        .post('/api/v1/rondas')
        .set(...bearer(token))
        .send({ tournamentId: inactive.id, number: 1 })
        .expect(400);
    });

    it('400: el número supera las rondas planeadas del torneo', async () => {
      const tournament = await makeTournament({ roundsPlanned: 3 });
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const res = await request(app)
        .post('/api/v1/rondas')
        .set(...bearer(token))
        .send({ tournamentId: tournament.id, number: 4 })
        .expect(400);
      expect(res.body.errors[0].field).toBe('number');
    });

    it('409: un torneo finalizado no admite rondas nuevas', async () => {
      const tournament = await makeTournament({ status: 'FINISHED' });
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const res = await request(app)
        .post('/api/v1/rondas')
        .set(...bearer(token))
        .send({ tournamentId: tournament.id, number: 1 })
        .expect(409);
      expect(res.body.code).toBe('TOURNAMENT_NOT_EDITABLE');
    });

    it('409 ROUND_DUPLICATE: mismo número en el mismo torneo, pero no en otro', async () => {
      const first = await makeTournament();
      const second = await makeTournament();
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const post = (tournamentId: string) =>
        request(app).post('/api/v1/rondas').set(...bearer(token)).send({ tournamentId, number: 1 });

      await post(first.id).expect(201);
      const dup = await post(first.id).expect(409);
      expect(dup.body.code).toBe('ROUND_DUPLICATE');
      await post(second.id).expect(201);
    });

    it('creaciones simultáneas del mismo número: una sola gana (RNF-02)', async () => {
      const tournament = await makeTournament();
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          request(app).post('/api/v1/rondas').set(...bearer(token)).send({ tournamentId: tournament.id, number: 1 }),
        ),
      );
      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(5);
    });
  });

  describe('GET /rondas', () => {
    it('200: lista vacía con meta', async () => {
      const { token } = await sessionWithRole(app);
      const res = await request(app).get('/api/v1/rondas').set(...bearer(token)).expect(200);
      expect(res.body).toEqual({ data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    });

    it('filtra por torneo y estado y ordena por número', async () => {
      const first = await makeTournament();
      const second = await makeTournament();
      await makeRound(first.id, 2);
      await makeRound(first.id, 1, { status: 'FINISHED' });
      await makeRound(second.id, 1);
      const { token } = await sessionWithRole(app);

      const all = await request(app)
        .get(`/api/v1/rondas?torneoId=${first.id}&sortBy=number&order=ASC`)
        .set(...bearer(token))
        .expect(200);
      expect(all.body.data.map((r: { number: number }) => r.number)).toEqual([1, 2]);

      const finished = await request(app)
        .get(`/api/v1/rondas?tournamentId=${first.id}&status=FINISHED`)
        .set(...bearer(token))
        .expect(200);
      expect(finished.body.meta.total).toBe(1);
    });

    it.each(['page=0', 'limit=101', 'sortBy=status', 'order=up', 'status=EN_CURSO', 'tournamentId=abc'])(
      '422: parámetro inválido %s',
      async (query) => {
        const { token } = await sessionWithRole(app);
        const res = await request(app).get(`/api/v1/rondas?${query}`).set(...bearer(token)).expect(422);
        expect(res.body.code).toBe('UNPROCESSABLE_ENTITY');
      },
    );
  });

  describe('GET, PATCH y DELETE /rondas/:id', () => {
    it('404 cuando no existe', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      await request(app).get(`/api/v1/rondas/${MISSING}`).set(...bearer(token)).expect(404);
      await request(app).patch(`/api/v1/rondas/${MISSING}`).set(...bearer(token)).send({ number: 2 }).expect(404);
      await request(app).delete(`/api/v1/rondas/${MISSING}`).set(...bearer(token)).expect(404);
    });

    it('PATCH: cambia el número de una ronda pendiente y rechaza duplicados y cuerpos vacíos', async () => {
      const tournament = await makeTournament();
      const round = await makeRound(tournament.id, 1);
      await makeRound(tournament.id, 2);
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const url = `/api/v1/rondas/${round.id}`;

      await request(app).patch(url).set(...bearer(token)).send({ number: 3 }).expect(200);
      await request(app).patch(url).set(...bearer(token)).send({ number: 2 }).expect(409);
      await request(app).patch(url).set(...bearer(token)).send({}).expect(400);
    });

    it('409 ROUND_NOT_EDITABLE: una ronda iniciada no se edita ni se da de baja', async () => {
      const tournament = await makeTournament();
      const round = await makeRound(tournament.id, 1, { status: 'IN_PROGRESS' });
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const url = `/api/v1/rondas/${round.id}`;

      const patch = await request(app).patch(url).set(...bearer(token)).send({ number: 2 }).expect(409);
      expect(patch.body.code).toBe('ROUND_NOT_EDITABLE');
      await request(app).delete(url).set(...bearer(token)).expect(409);
    });

    it('baja lógica: 200, idempotente, conserva el registro y sale del listado', async () => {
      const tournament = await makeTournament();
      const round = await makeRound(tournament.id, 1);
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const url = `/api/v1/rondas/${round.id}`;

      const first = await request(app).delete(url).set(...bearer(token)).expect(200);
      expect(first.body.isActive).toBe(false);
      await request(app).delete(url).set(...bearer(token)).expect(200);

      expect(await prisma.round.count({ where: { id: round.id } })).toBe(1);
      const list = await request(app).get('/api/v1/rondas').set(...bearer(token)).expect(200);
      expect(list.body.data).toHaveLength(0);
      await request(app).get(url).set(...bearer(token)).expect(200);
    });
  });

  it('alias en inglés: /rounds responde igual que /rondas', async () => {
    const { token } = await sessionWithRole(app);
    await request(app).get('/api/v1/rounds').set(...bearer(token)).expect(200);
  });
});
