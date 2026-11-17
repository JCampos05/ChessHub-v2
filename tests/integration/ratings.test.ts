import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { bearer, sessionWithRole } from '../helpers/auth.js';
import { prisma, resetDb } from '../helpers/db.js';
import { makePlayer } from '../helpers/factories.js';
import { enrollPlayers, makeTournamentWithCategory } from '../helpers/registrations.js';

const app = createApp();
const MISSING = '0190aaaa-0000-7000-8000-000000000099';
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe('ratings por sistema y ritmo (P-41)', () => {
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const post = (token: string, playerId: string, body: object) =>
    request(app).post(`/api/v1/jugadores/${playerId}/ratings`).set(...bearer(token)).send(body);

  const list = (token: string, playerId: string, query = '') =>
    request(app).get(`/api/v1/jugadores/${playerId}/ratings${query}`).set(...bearer(token));

  describe('alta', () => {
    it('401 sin token', async () => {
      await request(app).post(`/api/v1/jugadores/${MISSING}/ratings`).send({}).expect(401);
    });

    it('403 para quien no actualiza ratings y no se crea nada', async () => {
      const player = await makePlayer();
      const none = await sessionWithRole(app);
      const arbiter = await sessionWithRole(app, 'ARBITER');
      const body = { system: 'FIDE', pace: 'STANDARD', value: 1500 };
      await post(none.token, player.id, body).expect(403);
      await post(arbiter.token, player.id, body).expect(403);
      expect(await prisma.playerRating.count()).toBe(0);
    });

    it('201 registra el rating y lo devuelve', async () => {
      const player = await makePlayer();
      const { token, user } = await sessionWithRole(app, 'RATING_OFFICER');

      const res = await post(token, player.id, { system: 'FIDE', pace: 'RAPID', value: 1543.5, validFrom: '2026-03-01' }).expect(201);

      expect(res.body).toMatchObject({
        playerId: player.id,
        system: 'FIDE',
        pace: 'RAPID',
        stateCode: null,
        value: 1543.5,
        validFrom: '2026-03-01',
      });
      const stored = await prisma.playerRating.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(stored.createdById).toBe(user.id);
    });

    it('acepta alias en español, vigencia por omisión hoy y alias en inglés de la ruta', async () => {
      const player = await makePlayer();
      const { token } = await sessionWithRole(app, 'RATING_OFFICER');

      const res = await request(app)
        .post(`/api/v1/players/${player.id}/ratings`)
        .set(...bearer(token))
        .send({ sistema: 'STATE', ritmo: 'BLITZ', valor: 1200, estado: 'sin' })
        .expect(201);

      expect(res.body).toMatchObject({ system: 'STATE', pace: 'BLITZ', stateCode: 'SIN', value: 1200 });
      expect(res.body.validFrom).toBe(new Date().toISOString().slice(0, 10));
    });

    it('400 con datos inválidos', async () => {
      const player = await makePlayer();
      const { token } = await sessionWithRole(app, 'RATING_OFFICER');
      const bodies = [
        {},
        { system: 'ELO', pace: 'STANDARD', value: 1500 },
        { system: 'FIDE', pace: 'CLASSIC', value: 1500 },
        { system: 'FIDE', pace: 'STANDARD', value: -1 },
        { system: 'FIDE', pace: 'STANDARD', value: 3501 },
        { system: 'FIDE', pace: 'STANDARD', value: 1500.55 },
        { system: 'FIDE', pace: 'STANDARD', value: 1500, validFrom: '2026-13-45' },
        // El estatal exige estado y los demás no lo admiten
        { system: 'STATE', pace: 'STANDARD', value: 1500 },
        { system: 'FIDE', pace: 'STANDARD', value: 1500, stateCode: 'SIN' },
        { system: 'STATE', pace: 'STANDARD', value: 1500, stateCode: 'S' },
      ];
      for (const body of bodies) {
        const res = await post(token, player.id, body).expect(400);
        expect(res.body.status).toBe('error');
      }
      expect(await prisma.playerRating.count()).toBe(0);
    });

    it('404 si el jugador no existe o el id está mal formado', async () => {
      const { token } = await sessionWithRole(app, 'RATING_OFFICER');
      const body = { system: 'FIDE', pace: 'STANDARD', value: 1500 };
      await post(token, MISSING, body).expect(404);
      await post(token, 'no-es-uuid', body).expect(404);
    });

    it('409 RATING_DUPLICATE con el mismo sistema, ritmo, estado y vigencia', async () => {
      const player = await makePlayer();
      const { token } = await sessionWithRole(app, 'RATING_OFFICER');
      const body = { system: 'NATIONAL', pace: 'STANDARD', value: 1500, validFrom: '2026-01-01' };

      await post(token, player.id, body).expect(201);
      const res = await post(token, player.id, { ...body, value: 1600 }).expect(409);
      expect(res.body.code).toBe('RATING_DUPLICATE');
      expect(await prisma.playerRating.count()).toBe(1);
    });

    it('las versiones con otra vigencia, ritmo o estado conviven', async () => {
      const player = await makePlayer();
      const { token } = await sessionWithRole(app, 'RATING_OFFICER');
      const base = { system: 'STATE', pace: 'STANDARD', value: 1400, stateCode: 'SIN', validFrom: '2026-01-01' };

      await post(token, player.id, base).expect(201);
      await post(token, player.id, { ...base, validFrom: '2026-06-01', value: 1450 }).expect(201);
      await post(token, player.id, { ...base, pace: 'RAPID' }).expect(201);
      await post(token, player.id, { ...base, stateCode: 'JAL' }).expect(201);
      expect(await prisma.playerRating.count()).toBe(4);
    });
  });

  describe('historial', () => {
    it('401 sin token y 404 con jugador inexistente', async () => {
      await request(app).get(`/api/v1/jugadores/${MISSING}/ratings`).expect(401);
      const { token } = await sessionWithRole(app);
      await list(token, MISSING).expect(404);
      await list(token, 'no-es-uuid').expect(404);
    });

    it('lo lee cualquier usuario autenticado, de la vigencia más reciente a la más antigua', async () => {
      const player = await makePlayer();
      await prisma.playerRating.createMany({
        data: [
          { playerId: player.id, system: 'FIDE', pace: 'STANDARD', value: 1500, validFrom: day('2026-01-01') },
          { playerId: player.id, system: 'FIDE', pace: 'STANDARD', value: 1550, validFrom: day('2026-06-01') },
          { playerId: player.id, system: 'FIDE', pace: 'RAPID', value: 1400, validFrom: day('2026-03-01') },
        ],
      });
      const { token } = await sessionWithRole(app);

      const res = await list(token, player.id).expect(200);

      expect(res.body.meta.total).toBe(3);
      expect(res.body.data.map((r: { validFrom: string }) => r.validFrom)).toEqual(['2026-06-01', '2026-03-01', '2026-01-01']);
    });

    it('filtra por sistema y ritmo y rechaza valores desconocidos con 422', async () => {
      const player = await makePlayer();
      await prisma.playerRating.createMany({
        data: [
          { playerId: player.id, system: 'FIDE', pace: 'STANDARD', value: 1500, validFrom: day('2026-01-01') },
          { playerId: player.id, system: 'NATIONAL', pace: 'STANDARD', value: 1450, validFrom: day('2026-01-01') },
          { playerId: player.id, system: 'FIDE', pace: 'BLITZ', value: 1300, validFrom: day('2026-01-01') },
        ],
      });
      const { token } = await sessionWithRole(app);

      const fide = await list(token, player.id, '?system=FIDE').expect(200);
      expect(fide.body.data).toHaveLength(2);
      const blitz = await list(token, player.id, '?sistema=FIDE&ritmo=BLITZ').expect(200);
      expect(blitz.body.data.map((r: { value: number }) => r.value)).toEqual([1300]);
      await list(token, player.id, '?system=ELO').expect(422);
    });

    it('no mezcla los ratings de otros jugadores', async () => {
      const [a, b] = [await makePlayer(), await makePlayer()];
      await prisma.playerRating.createMany({
        data: [
          { playerId: a.id, system: 'FIDE', pace: 'STANDARD', value: 1500, validFrom: day('2026-01-01') },
          { playerId: b.id, system: 'FIDE', pace: 'STANDARD', value: 1700, validFrom: day('2026-01-01') },
        ],
      });
      const { token } = await sessionWithRole(app);
      const res = await list(token, a.id).expect(200);
      expect(res.body.data.map((r: { value: number }) => r.value)).toEqual([1500]);
    });
  });

  describe('restricciones de la base', () => {
    it('el estatal sin estado y el rating con estado que no es estatal se rechazan', async () => {
      const player = await makePlayer();
      const base = { playerId: player.id, pace: 'STANDARD' as const, value: 1500, validFrom: day('2026-01-01') };
      await expect(prisma.playerRating.create({ data: { ...base, system: 'STATE' } })).rejects.toThrow();
      await expect(prisma.playerRating.create({ data: { ...base, system: 'FIDE', stateCode: 'SIN' } })).rejects.toThrow();
    });

    it('el valor fuera de rango y el estado mal formado se rechazan', async () => {
      const player = await makePlayer();
      const base = { playerId: player.id, system: 'FIDE' as const, pace: 'STANDARD' as const, validFrom: day('2026-01-01') };
      await expect(prisma.playerRating.create({ data: { ...base, value: 3501 } })).rejects.toThrow();
      await expect(
        prisma.playerRating.create({ data: { ...base, system: 'STATE', stateCode: 'sin', value: 1500 } }),
      ).rejects.toThrow();
    });

    it('la versión duplicada con estado nulo también se rechaza (índice sobre COALESCE)', async () => {
      const player = await makePlayer();
      const data = { playerId: player.id, system: 'FIDE' as const, pace: 'STANDARD' as const, value: 1500, validFrom: day('2026-01-01') };
      await prisma.playerRating.create({ data });
      await expect(prisma.playerRating.create({ data })).rejects.toThrow();
    });
  });

  describe('preferencia del torneo', () => {
    it('el torneo nuevo usa FIDE en ritmo estándar y lo expone', async () => {
      const { tournament } = await makeTournamentWithCategory();
      const { token } = await sessionWithRole(app);
      const res = await request(app).get(`/api/v1/torneos/${tournament.id}`).set(...bearer(token)).expect(200);
      expect(res.body).toMatchObject({ ratingSystem: 'FIDE', ratingPace: 'STANDARD', ratingStateCode: null });
    });

    it('se declara al crear y se cambia al actualizar', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const created = await request(app)
        .post('/api/v1/torneos')
        .set(...bearer(token))
        .send({
          name: 'Torneo con ratings',
          startDate: '2026-12-05',
          endDate: '2026-12-06',
          ratingSystem: 'STATE',
          ratingPace: 'BLITZ',
          ratingStateCode: 'sin',
        })
        .expect(201);
      expect(created.body).toMatchObject({ ratingSystem: 'STATE', ratingPace: 'BLITZ', ratingStateCode: 'SIN' });

      const updated = await request(app)
        .patch(`/api/v1/torneos/${created.body.id}`)
        .set(...bearer(token))
        .send({ sistemaRating: 'NATIONAL', ratingStateCode: null })
        .expect(200);
      expect(updated.body).toMatchObject({ ratingSystem: 'NATIONAL', ratingPace: 'BLITZ', ratingStateCode: null });
    });

    it('400 con un sistema, ritmo o estado inválido', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const base = { name: 'Torneo inválido', startDate: '2026-12-05', endDate: '2026-12-06' };
      for (const extra of [{ ratingSystem: 'ELO' }, { ratingPace: 'CLASSIC' }, { ratingStateCode: '1' }]) {
        await request(app)
          .post('/api/v1/torneos')
          .set(...bearer(token))
          .send({ ...base, ...extra })
          .expect(400);
      }
    });
  });

  describe('siembra de la ronda con el rating del torneo', () => {
    const generate = (token: string, tournamentId: string) =>
      request(app)
        .post(`/api/v1/torneos/${tournamentId}/rondas/generar`)
        .set(...bearer(token))
        .send({});

    // Los jugadores se inscriben con rating único descendente (p0 el mejor); los ratings nuevos invierten el orden
    async function reverseRatings(
      players: { id: string }[],
      system: 'FIDE' | 'NATIONAL' | 'STATE',
      pace: 'STANDARD' | 'RAPID' | 'BLITZ',
    ) {
      await prisma.playerRating.createMany({
        data: players.map((player, index) => ({
          playerId: player.id,
          system,
          pace,
          stateCode: system === 'STATE' ? 'SIN' : null,
          value: 1000 + index * 100,
          validFrom: day('2026-01-01'),
        })),
      });
    }

    const firstBoard = (body: { pairings: { whitePlayerId: string; blackPlayerId: string | null }[] }) =>
      [body.pairings[0]!.whitePlayerId, body.pairings[0]!.blackPlayerId].sort();

    it('sin ratings nuevos siembra con la columna anterior (compatibilidad)', async () => {
      const { tournament, category } = await makeTournamentWithCategory();
      const players = await enrollPlayers(tournament.id, category.id, 4);
      const { token } = await sessionWithRole(app, 'CHIEF_ARBITER');

      const res = await generate(token, tournament.id).expect(201);
      expect(firstBoard(res.body)).toEqual([players[0]!.id, players[2]!.id].sort());
    });

    it('usa el sistema que declara el torneo', async () => {
      const { tournament, category } = await makeTournamentWithCategory({ ratingSystem: 'NATIONAL' });
      const players = await enrollPlayers(tournament.id, category.id, 4);
      await reverseRatings(players, 'NATIONAL', 'STANDARD');
      const { token } = await sessionWithRole(app, 'CHIEF_ARBITER');

      // Con el rating nacional el mejor es p3 y la mesa 1 es p3 contra p1
      const res = await generate(token, tournament.id).expect(201);
      expect(firstBoard(res.body)).toEqual([players[3]!.id, players[1]!.id].sort());
    });

    it('usa el ritmo que declara el torneo e ignora la columna anterior', async () => {
      const { tournament, category } = await makeTournamentWithCategory({ ratingPace: 'RAPID' });
      const players = await enrollPlayers(tournament.id, category.id, 4);
      await reverseRatings(players, 'FIDE', 'RAPID');
      const { token } = await sessionWithRole(app, 'CHIEF_ARBITER');

      const res = await generate(token, tournament.id).expect(201);
      expect(firstBoard(res.body)).toEqual([players[3]!.id, players[1]!.id].sort());
    });

    it('respalda en otro sistema del mismo ritmo cuando falta el preferido', async () => {
      const { tournament, category } = await makeTournamentWithCategory({ ratingSystem: 'FIDE' });
      const players = await enrollPlayers(tournament.id, category.id, 4);
      await reverseRatings(players, 'NATIONAL', 'STANDARD');
      const { token } = await sessionWithRole(app, 'CHIEF_ARBITER');

      const res = await generate(token, tournament.id).expect(201);
      expect(firstBoard(res.body)).toEqual([players[3]!.id, players[1]!.id].sort());
    });

    it('un rating con vigencia futura no se usa', async () => {
      const { tournament, category } = await makeTournamentWithCategory();
      const players = await enrollPlayers(tournament.id, category.id, 4);
      await prisma.playerRating.createMany({
        data: players.map((player, index) => ({
          playerId: player.id,
          system: 'FIDE' as const,
          pace: 'STANDARD' as const,
          value: 1000 + index * 100,
          validFrom: day('2999-01-01'),
        })),
      });
      const { token } = await sessionWithRole(app, 'CHIEF_ARBITER');

      const res = await generate(token, tournament.id).expect(201);
      expect(firstBoard(res.body)).toEqual([players[0]!.id, players[2]!.id].sort());
    });
  });
});
