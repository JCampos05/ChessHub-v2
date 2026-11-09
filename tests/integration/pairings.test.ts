import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { bearer, grantScopedRole, sessionWithRole } from '../helpers/auth.js';
import { prisma, resetDb } from '../helpers/db.js';
import { makePlayer, makeRound, makeTournament } from '../helpers/factories.js';

const app = createApp();
const MISSING = '0190aaaa-0000-7000-8000-000000000099';

async function setup() {
  const tournament = await makeTournament();
  await makeRound(tournament.id, 1);
  const [a, b, c, d] = await Promise.all([makePlayer(), makePlayer(), makePlayer(), makePlayer()]);
  return { tournament, a, b, c, d };
}

describe('emparejamientos (RF08, RNF08)', () => {
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('autenticación y permisos', () => {
    it('401 sin token', async () => {
      await request(app).get('/api/v1/emparejamientos').expect(401);
      await request(app).post('/api/v1/emparejamientos').send({}).expect(401);
      await request(app).delete('/api/v1/emparejamientos/1').expect(401);
    });

    it('un usuario sin rol lee pero no crea (403)', async () => {
      const { tournament, a, b } = await setup();
      const { token } = await sessionWithRole(app);
      await request(app).get('/api/v1/emparejamientos').set(...bearer(token)).expect(200);
      await request(app)
        .post('/api/v1/emparejamientos')
        .set(...bearer(token))
        .send({ tournamentId: tournament.id, roundNumber: 1, board: 1, whitePlayerId: a.id, blackPlayerId: b.id })
        .expect(403);
    });

    it('el árbitro principal de otro torneo recibe 403 OUT_OF_SCOPE', async () => {
      const { tournament, a, b } = await setup();
      const other = await makeTournament();
      const { token, user } = await sessionWithRole(app);
      await grantScopedRole(user.id, 'CHIEF_ARBITER', 'TOURNAMENT', other.id);
      const res = await request(app)
        .post('/api/v1/emparejamientos')
        .set(...bearer(token))
        .send({ tournamentId: tournament.id, roundNumber: 1, board: 1, whitePlayerId: a.id, blackPlayerId: b.id })
        .expect(403);
      expect(res.body.code).toBe('OUT_OF_SCOPE');
    });

    it('id malformado responde 404', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      await request(app).get('/api/v1/emparejamientos/1').set(...bearer(token)).expect(404);
      await request(app).patch('/api/v1/emparejamientos/1').set(...bearer(token)).send({ board: 2 }).expect(404);
    });
  });

  describe('POST /emparejamientos', () => {
    it('201: crea la mesa con alias en español', async () => {
      const { tournament, a, b } = await setup();
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const res = await request(app)
        .post('/api/v1/emparejamientos')
        .set(...bearer(token))
        .send({ torneoId: tournament.id, rondaNum: 1, mesa: 1, blancasId: a.id, negrasId: b.id })
        .expect(201);
      expect(res.body).toMatchObject({
        tournamentId: tournament.id,
        roundNumber: 1,
        board: 1,
        whitePlayerId: a.id,
        blackPlayerId: b.id,
        isBye: false,
        isActive: true,
      });
    });

    it('201: sin jugador de negras es un descanso (bye)', async () => {
      const { tournament, a } = await setup();
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const res = await request(app)
        .post('/api/v1/emparejamientos')
        .set(...bearer(token))
        .send({ tournamentId: tournament.id, roundNumber: 1, board: 1, whitePlayerId: a.id, blackPlayerId: null })
        .expect(201);
      expect(res.body).toMatchObject({ blackPlayerId: null, isBye: true });
    });

    it('400: cuerpo vacío', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const res = await request(app).post('/api/v1/emparejamientos').set(...bearer(token)).send({}).expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it.each([
      ['mesa cero', { board: 0 }],
      ['mesa no numérica', { board: 'uno' }],
      ['ronda cero', { roundNumber: 0 }],
      ['torneo con formato inválido', { tournamentId: 'abc' }],
      ['jugador con formato inválido', { whitePlayerId: 'abc' }],
    ])('400: %s', async (_caso, patch) => {
      const { tournament, a, b } = await setup();
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const res = await request(app)
        .post('/api/v1/emparejamientos')
        .set(...bearer(token))
        .send({
          tournamentId: tournament.id,
          roundNumber: 1,
          board: 1,
          whitePlayerId: a.id,
          blackPlayerId: b.id,
          ...patch,
        })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('400: un jugador no puede jugar contra sí mismo', async () => {
      const { tournament, a } = await setup();
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const res = await request(app)
        .post('/api/v1/emparejamientos')
        .set(...bearer(token))
        .send({ tournamentId: tournament.id, roundNumber: 1, board: 1, whitePlayerId: a.id, blackPlayerId: a.id })
        .expect(400);
      expect(res.body.errors[0].field).toBe('blackPlayerId');
    });

    it('400 REFERENCE_NOT_FOUND: torneo, ronda o jugadores inexistentes', async () => {
      const { tournament, a, b } = await setup();
      const inactive = await makePlayer({ status: 'INACTIVE' });
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const post = (body: object) =>
        request(app)
          .post('/api/v1/emparejamientos')
          .set(...bearer(token))
          .send({ tournamentId: tournament.id, roundNumber: 1, board: 1, whitePlayerId: a.id, blackPlayerId: b.id, ...body });

      for (const body of [
        { tournamentId: MISSING },
        { roundNumber: 5 },
        { whitePlayerId: MISSING },
        { blackPlayerId: MISSING },
        { blackPlayerId: inactive.id },
      ]) {
        const res = await post(body).expect(400);
        expect(res.body.code).toBe('REFERENCE_NOT_FOUND');
      }
    });

    it('409 ROUND_NOT_EDITABLE: la ronda ya empezó', async () => {
      const tournament = await makeTournament();
      await makeRound(tournament.id, 1, { status: 'IN_PROGRESS' });
      const [a, b] = await Promise.all([makePlayer(), makePlayer()]);
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const res = await request(app)
        .post('/api/v1/emparejamientos')
        .set(...bearer(token))
        .send({ tournamentId: tournament.id, roundNumber: 1, board: 1, whitePlayerId: a.id, blackPlayerId: b.id })
        .expect(409);
      expect(res.body.code).toBe('ROUND_NOT_EDITABLE');
    });

    it('409 BOARD_TAKEN: la mesa ya está ocupada en la ronda, pero libre en otra', async () => {
      const { tournament, a, b, c, d } = await setup();
      await makeRound(tournament.id, 2);
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const post = (roundNumber: number, white: string, black: string) =>
        request(app)
          .post('/api/v1/emparejamientos')
          .set(...bearer(token))
          .send({ tournamentId: tournament.id, roundNumber, board: 1, whitePlayerId: white, blackPlayerId: black });

      await post(1, a.id, b.id).expect(201);
      const dup = await post(1, c.id, d.id).expect(409);
      expect(dup.body.code).toBe('BOARD_TAKEN');
      await post(2, c.id, d.id).expect(201);
    });

    it('409 PLAYER_ALREADY_PAIRED: un jugador no ocupa dos mesas, ni con colores distintos', async () => {
      const { tournament, a, b, c, d } = await setup();
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const post = (board: number, white: string, black: string | null) =>
        request(app)
          .post('/api/v1/emparejamientos')
          .set(...bearer(token))
          .send({ tournamentId: tournament.id, roundNumber: 1, board, whitePlayerId: white, blackPlayerId: black });

      await post(1, a.id, b.id).expect(201);
      for (const [board, white, black] of [
        [2, a.id, c.id], // mismo color
        [3, c.id, b.id], // mismo color
        [4, b.id, c.id], // b de blancas tras ser negras
        [5, c.id, a.id], // a de negras tras ser blancas
        [6, a.id, null], // bye de quien ya tiene mesa
      ] as const) {
        const res = await post(board, white, black).expect(409);
        expect(res.body.code).toBe('PLAYER_ALREADY_PAIRED');
      }
      await post(2, c.id, d.id).expect(201);
    });

    it('solicitudes simultáneas por la misma mesa o el mismo jugador: solo una gana (RNF-02)', async () => {
      const { tournament, a, b, c, d } = await setup();
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const send = (board: number, white: string, black: string) =>
        request(app)
          .post('/api/v1/emparejamientos')
          .set(...bearer(token))
          .send({ tournamentId: tournament.id, roundNumber: 1, board, whitePlayerId: white, blackPlayerId: black });

      // Mismo jugador a en mesas distintas, a veces de blancas y a veces de negras
      const results = await Promise.all([
        send(1, a.id, b.id),
        send(2, c.id, a.id),
        send(3, a.id, d.id),
        send(4, d.id, a.id),
      ]);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(3);
      expect(await prisma.pairing.count()).toBe(1);
    });
  });

  describe('GET /emparejamientos', () => {
    it('200: lista vacía con meta', async () => {
      const { token } = await sessionWithRole(app);
      const res = await request(app).get('/api/v1/emparejamientos').set(...bearer(token)).expect(200);
      expect(res.body).toEqual({ data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    });

    it('filtra por torneo, ronda y jugador y ordena por mesa', async () => {
      const { tournament, a, b, c, d } = await setup();
      await makeRound(tournament.id, 2);
      await prisma.pairing.createMany({
        data: [
          { tournamentId: tournament.id, roundNumber: 1, board: 2, whitePlayerId: c.id, blackPlayerId: d.id },
          { tournamentId: tournament.id, roundNumber: 1, board: 1, whitePlayerId: a.id, blackPlayerId: b.id },
          { tournamentId: tournament.id, roundNumber: 2, board: 1, whitePlayerId: b.id, blackPlayerId: c.id },
        ],
      });
      const { token } = await sessionWithRole(app);

      const round1 = await request(app)
        .get(`/api/v1/emparejamientos?torneoId=${tournament.id}&rondaNum=1`)
        .set(...bearer(token))
        .expect(200);
      expect(round1.body.data.map((p: { board: number }) => p.board)).toEqual([1, 2]);

      const ofB = await request(app)
        .get(`/api/v1/emparejamientos?playerId=${b.id}&sortBy=roundNumber&order=ASC`)
        .set(...bearer(token))
        .expect(200);
      expect(ofB.body.meta.total).toBe(2);
    });

    it.each(['page=0', 'limit=101', 'sortBy=white', 'order=up', 'roundNumber=0', 'playerId=abc'])(
      '422: parámetro inválido %s',
      async (query) => {
        const { token } = await sessionWithRole(app);
        const res = await request(app).get(`/api/v1/emparejamientos?${query}`).set(...bearer(token)).expect(422);
        expect(res.body.code).toBe('UNPROCESSABLE_ENTITY');
      },
    );
  });

  describe('GET, PATCH y DELETE /emparejamientos/:id', () => {
    it('404 cuando no existe', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      await request(app).get(`/api/v1/emparejamientos/${MISSING}`).set(...bearer(token)).expect(404);
      await request(app).patch(`/api/v1/emparejamientos/${MISSING}`).set(...bearer(token)).send({ board: 2 }).expect(404);
      await request(app).delete(`/api/v1/emparejamientos/${MISSING}`).set(...bearer(token)).expect(404);
    });

    it('PATCH: cambia la mesa y los jugadores respetando las reglas de la ronda', async () => {
      const { tournament, a, b, c, d } = await setup();
      const first = await prisma.pairing.create({
        data: { tournamentId: tournament.id, roundNumber: 1, board: 1, whitePlayerId: a.id, blackPlayerId: b.id },
      });
      await prisma.pairing.create({
        data: { tournamentId: tournament.id, roundNumber: 1, board: 2, whitePlayerId: c.id, blackPlayerId: d.id },
      });
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const url = `/api/v1/emparejamientos/${first.id}`;

      // Reescribir con los mismos valores no choca consigo mismo
      await request(app).patch(url).set(...bearer(token)).send({ board: 1 }).expect(200);
      await request(app).patch(url).set(...bearer(token)).send({ board: 3 }).expect(200);
      const bye = await request(app).patch(url).set(...bearer(token)).send({ blackPlayerId: null }).expect(200);
      expect(bye.body.isBye).toBe(true);

      expect((await request(app).patch(url).set(...bearer(token)).send({ board: 2 }).expect(409)).body.code).toBe(
        'BOARD_TAKEN',
      );
      expect(
        (await request(app).patch(url).set(...bearer(token)).send({ blackPlayerId: c.id }).expect(409)).body.code,
      ).toBe('PLAYER_ALREADY_PAIRED');
      await request(app).patch(url).set(...bearer(token)).send({ blackPlayerId: a.id }).expect(400);
      await request(app).patch(url).set(...bearer(token)).send({}).expect(400);
    });

    it('409 ROUND_NOT_EDITABLE: con la ronda iniciada no se edita ni se da de baja', async () => {
      const { tournament, a, b } = await setup();
      const pairing = await prisma.pairing.create({
        data: { tournamentId: tournament.id, roundNumber: 1, board: 1, whitePlayerId: a.id, blackPlayerId: b.id },
      });
      await prisma.round.update({
        where: { tournamentId_number: { tournamentId: tournament.id, number: 1 } },
        data: { status: 'IN_PROGRESS' },
      });
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const url = `/api/v1/emparejamientos/${pairing.id}`;
      await request(app).patch(url).set(...bearer(token)).send({ board: 2 }).expect(409);
      await request(app).delete(url).set(...bearer(token)).expect(409);
    });

    it('baja lógica: 200, idempotente, conserva el registro y sale del listado', async () => {
      const { tournament, a, b } = await setup();
      const pairing = await prisma.pairing.create({
        data: { tournamentId: tournament.id, roundNumber: 1, board: 1, whitePlayerId: a.id, blackPlayerId: b.id },
      });
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const url = `/api/v1/emparejamientos/${pairing.id}`;

      const first = await request(app).delete(url).set(...bearer(token)).expect(200);
      expect(first.body.isActive).toBe(false);
      await request(app).delete(url).set(...bearer(token)).expect(200);

      expect(await prisma.pairing.count({ where: { id: pairing.id } })).toBe(1);
      const list = await request(app).get('/api/v1/emparejamientos').set(...bearer(token)).expect(200);
      expect(list.body.data).toHaveLength(0);
      await request(app).get(url).set(...bearer(token)).expect(200);
    });
  });

  it('integridad: la ronda con emparejamientos no se puede borrar de la base (RESTRICT)', async () => {
    const { tournament, a, b } = await setup();
    await prisma.pairing.create({
      data: { tournamentId: tournament.id, roundNumber: 1, board: 1, whitePlayerId: a.id, blackPlayerId: b.id },
    });
    await expect(prisma.round.deleteMany({ where: { tournamentId: tournament.id } })).rejects.toThrow();
  });

  it('alias en inglés: /pairings responde igual que /emparejamientos', async () => {
    const { token } = await sessionWithRole(app);
    await request(app).get('/api/v1/pairings').set(...bearer(token)).expect(200);
  });
});
