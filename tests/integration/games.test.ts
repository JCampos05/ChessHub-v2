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
  const [a, b, c] = await Promise.all([makePlayer(), makePlayer(), makePlayer()]);
  const body = { tournamentId: tournament.id, roundNumber: 1, whitePlayerId: a.id, blackPlayerId: b.id };
  return { tournament, a, b, c, body };
}

describe('partidas (RF08, RNF08)', () => {
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('autenticación y permisos', () => {
    it('401 sin token', async () => {
      await request(app).get('/api/v1/partidas').expect(401);
      await request(app).post('/api/v1/partidas').send({}).expect(401);
      await request(app).delete('/api/v1/partidas/1').expect(401);
    });

    it('un usuario sin rol lee pero no crea (403)', async () => {
      const { body } = await setup();
      const { token } = await sessionWithRole(app);
      await request(app).get('/api/v1/partidas').set(...bearer(token)).expect(200);
      await request(app).post('/api/v1/partidas').set(...bearer(token)).send(body).expect(403);
    });

    it('un árbitro con ámbito en ese torneo crea partidas; en otro torneo recibe 403 OUT_OF_SCOPE', async () => {
      const { body } = await setup();
      const other = await makeTournament();
      const { token, user } = await sessionWithRole(app);
      await grantScopedRole(user.id, 'ARBITER', 'TOURNAMENT', other.id);
      const res = await request(app).post('/api/v1/partidas').set(...bearer(token)).send(body).expect(403);
      expect(res.body.code).toBe('OUT_OF_SCOPE');
    });

    it('id malformado responde 404', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      await request(app).get('/api/v1/partidas/1').set(...bearer(token)).expect(404);
      await request(app).patch('/api/v1/partidas/1').set(...bearer(token)).send({ pgn: '1. e4' }).expect(404);
    });
  });

  describe('POST /partidas', () => {
    it('201: crea la partida pendiente e ignora el resultado enviado', async () => {
      const { body } = await setup();
      const { token } = await sessionWithRole(app, 'ARBITER');
      const res = await request(app)
        .post('/api/v1/partidas')
        .set(...bearer(token))
        .send({ ...body, result: 'WHITE_WINS' })
        .expect(201);
      expect(res.body).toMatchObject({ ...body, result: 'PENDING', pairingId: null, pgn: null, isActive: true });
    });

    it('acepta alias en español, PGN y fecha de juego', async () => {
      const { tournament, a, b } = await setup();
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const res = await request(app)
        .post('/api/v1/partidas')
        .set(...bearer(token))
        .send({
          torneoId: tournament.id,
          rondaNum: 1,
          blancasId: a.id,
          negrasId: b.id,
          pgn: '1. e4 e5',
          playedAt: '2026-12-05T16:00:00-07:00',
        })
        .expect(201);
      expect(res.body.pgn).toBe('1. e4 e5');
      expect(new Date(res.body.playedAt).toISOString()).toBe('2026-12-05T23:00:00.000Z');
    });

    it('400: cuerpo vacío', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const res = await request(app).post('/api/v1/partidas').set(...bearer(token)).send({}).expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it.each([
      ['ronda cero', { roundNumber: 0 }],
      ['torneo con formato inválido', { tournamentId: 'abc' }],
      ['jugador con formato inválido', { blackPlayerId: 'abc' }],
      ['fecha inválida', { playedAt: 'ayer' }],
      ['PGN vacío', { pgn: '   ' }],
      ['sin negras', { blackPlayerId: undefined }],
    ])('400: %s', async (_caso, patch) => {
      const { body } = await setup();
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const res = await request(app)
        .post('/api/v1/partidas')
        .set(...bearer(token))
        .send({ ...body, ...patch })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('400: un jugador no puede jugar contra sí mismo', async () => {
      const { body, a } = await setup();
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const res = await request(app)
        .post('/api/v1/partidas')
        .set(...bearer(token))
        .send({ ...body, blackPlayerId: a.id })
        .expect(400);
      expect(res.body.errors[0].field).toBe('blackPlayerId');
    });

    it('400 REFERENCE_NOT_FOUND: torneo, ronda o jugadores inexistentes o inactivos', async () => {
      const { body } = await setup();
      const inactive = await makePlayer({ status: 'INACTIVE' });
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      for (const patch of [
        { tournamentId: MISSING },
        { roundNumber: 7 },
        { whitePlayerId: MISSING },
        { blackPlayerId: inactive.id },
        { pairingId: MISSING },
      ]) {
        const res = await request(app)
          .post('/api/v1/partidas')
          .set(...bearer(token))
          .send({ ...body, ...patch })
          .expect(400);
        expect(res.body.code).toBe('REFERENCE_NOT_FOUND');
      }
    });

    it('409 ROUND_NOT_EDITABLE: la ronda ya terminó', async () => {
      const tournament = await makeTournament();
      await makeRound(tournament.id, 1, { status: 'FINISHED' });
      const [a, b] = await Promise.all([makePlayer(), makePlayer()]);
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const res = await request(app)
        .post('/api/v1/partidas')
        .set(...bearer(token))
        .send({ tournamentId: tournament.id, roundNumber: 1, whitePlayerId: a.id, blackPlayerId: b.id })
        .expect(409);
      expect(res.body.code).toBe('ROUND_NOT_EDITABLE');
    });

    it('vinculada a un emparejamiento: valida ronda y jugadores, y solo admite una partida (409 GAME_DUPLICATE)', async () => {
      const { tournament, a, b, c, body } = await setup();
      await makeRound(tournament.id, 2);
      const pairing = await prisma.pairing.create({
        data: { tournamentId: tournament.id, roundNumber: 1, board: 1, whitePlayerId: a.id, blackPlayerId: b.id },
      });
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const post = (patch: object) =>
        request(app)
          .post('/api/v1/partidas')
          .set(...bearer(token))
          .send({ ...body, pairingId: pairing.id, ...patch });

      await post({ roundNumber: 2 }).expect(400);
      await post({ blackPlayerId: c.id }).expect(400);
      await post({}).expect(201);
      const dup = await post({}).expect(409);
      expect(dup.body.code).toBe('GAME_DUPLICATE');
    });
  });

  describe('GET /partidas', () => {
    it('200: lista vacía con meta', async () => {
      const { token } = await sessionWithRole(app);
      const res = await request(app).get('/api/v1/partidas').set(...bearer(token)).expect(200);
      expect(res.body).toEqual({ data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    });

    it('filtra por torneo, ronda, jugador y resultado', async () => {
      const { tournament, a, b, c } = await setup();
      await makeRound(tournament.id, 2);
      await prisma.game.createMany({
        data: [
          { tournamentId: tournament.id, roundNumber: 1, whitePlayerId: a.id, blackPlayerId: b.id, result: 'DRAW' },
          { tournamentId: tournament.id, roundNumber: 2, whitePlayerId: b.id, blackPlayerId: c.id },
        ],
      });
      const { token } = await sessionWithRole(app);
      const get = (query: string) => request(app).get(`/api/v1/partidas?${query}`).set(...bearer(token)).expect(200);

      expect((await get(`torneoId=${tournament.id}&rondaNum=1`)).body.meta.total).toBe(1);
      expect((await get(`playerId=${b.id}`)).body.meta.total).toBe(2);
      expect((await get('result=DRAW')).body.meta.total).toBe(1);
      expect((await get('resultado=PENDING')).body.meta.total).toBe(1);
    });

    it.each(['page=0', 'limit=101', 'sortBy=pgn', 'order=up', 'result=GANA', 'roundNumber=0', 'playerId=abc'])(
      '422: parámetro inválido %s',
      async (query) => {
        const { token } = await sessionWithRole(app);
        const res = await request(app).get(`/api/v1/partidas?${query}`).set(...bearer(token)).expect(422);
        expect(res.body.code).toBe('UNPROCESSABLE_ENTITY');
      },
    );
  });

  describe('GET, PATCH y DELETE /partidas/:id', () => {
    const create = async () => {
      const { tournament, a, b } = await setup();
      return prisma.game.create({
        data: { tournamentId: tournament.id, roundNumber: 1, whitePlayerId: a.id, blackPlayerId: b.id },
      });
    };

    it('404 cuando no existe', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      await request(app).get(`/api/v1/partidas/${MISSING}`).set(...bearer(token)).expect(404);
      await request(app).patch(`/api/v1/partidas/${MISSING}`).set(...bearer(token)).send({ pgn: 'x' }).expect(404);
      await request(app).delete(`/api/v1/partidas/${MISSING}`).set(...bearer(token)).expect(404);
    });

    it('PATCH: actualiza PGN y fecha, permite limpiarlos y rechaza cuerpos vacíos', async () => {
      const game = await create();
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const url = `/api/v1/partidas/${game.id}`;

      const set = await request(app).patch(url).set(...bearer(token)).send({ pgn: '1. d4 d5' }).expect(200);
      expect(set.body.pgn).toBe('1. d4 d5');
      const clear = await request(app).patch(url).set(...bearer(token)).send({ pgn: null }).expect(200);
      expect(clear.body.pgn).toBeNull();
      await request(app).patch(url).set(...bearer(token)).send({}).expect(400);
    });

    it('PATCH no permite cambiar el resultado', async () => {
      const game = await create();
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      await request(app).patch(`/api/v1/partidas/${game.id}`).set(...bearer(token)).send({ result: 'DRAW' }).expect(400);
    });

    it('baja lógica: 200, idempotente, conserva el registro y sale del listado', async () => {
      const game = await create();
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const url = `/api/v1/partidas/${game.id}`;

      const first = await request(app).delete(url).set(...bearer(token)).expect(200);
      expect(first.body.isActive).toBe(false);
      await request(app).delete(url).set(...bearer(token)).expect(200);

      expect(await prisma.game.count({ where: { id: game.id } })).toBe(1);
      const list = await request(app).get('/api/v1/partidas').set(...bearer(token)).expect(200);
      expect(list.body.data).toHaveLength(0);
      await request(app).get(url).set(...bearer(token)).expect(200);
    });

    it('409 GAME_HAS_RESULT: una partida con resultado no se da de baja', async () => {
      const game = await create();
      await prisma.game.update({ where: { id: game.id }, data: { result: 'WHITE_WINS' } });
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const res = await request(app).delete(`/api/v1/partidas/${game.id}`).set(...bearer(token)).expect(409);
      expect(res.body.code).toBe('GAME_HAS_RESULT');
    });
  });

  it('integridad: la base rechaza una partida de un jugador contra sí mismo y una ronda inexistente', async () => {
    const { tournament, a, b } = await setup();
    await expect(
      prisma.game.create({
        data: { tournamentId: tournament.id, roundNumber: 1, whitePlayerId: a.id, blackPlayerId: a.id },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.game.create({
        data: { tournamentId: tournament.id, roundNumber: 9, whitePlayerId: a.id, blackPlayerId: b.id },
      }),
    ).rejects.toThrow();
  });

  it('alias en inglés: /games responde igual que /partidas', async () => {
    const { token } = await sessionWithRole(app);
    await request(app).get('/api/v1/games').set(...bearer(token)).expect(200);
  });
});
