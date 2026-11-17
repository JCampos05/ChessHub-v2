import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { bearer, grantScopedRole, sessionWithRole } from '../helpers/auth.js';
import { prisma, resetDb } from '../helpers/db.js';
import { makeRound } from '../helpers/factories.js';
import {
  enrollPlayers,
  finishRoundGames,
  makeTournamentWithCategory,
  startTournament,
} from '../helpers/registrations.js';

const app = createApp();
const MISSING = '0190aaaa-0000-7000-8000-000000000099';

describe('generar ronda (RF16, RF17, RN-04)', () => {
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const generate = (token: string, tournamentId: string) =>
    request(app)
      .post(`/api/v1/torneos/${tournamentId}/rondas/generar`)
      .set(...bearer(token))
      .send({});

  describe('autenticación y permisos', () => {
    it('401 sin token', async () => {
      await request(app).post(`/api/v1/torneos/${MISSING}/rondas/generar`).send({}).expect(401);
    });

    it('un usuario sin rol recibe 403 aunque el id no sea válido', async () => {
      const { token } = await sessionWithRole(app);
      await request(app).post('/api/v1/torneos/1/rondas/generar').set(...bearer(token)).send({}).expect(403);
    });

    it('el árbitro de mesa no genera rondas (403)', async () => {
      const { tournament } = await makeTournamentWithCategory();
      const { token } = await sessionWithRole(app, 'ARBITER');
      await generate(token, tournament.id).expect(403);
    });

    it('el árbitro principal de un torneo no genera rondas de otro (403 OUT_OF_SCOPE)', async () => {
      const mine = await makeTournamentWithCategory();
      const other = await makeTournamentWithCategory();
      await enrollPlayers(mine.tournament.id, mine.category.id, 4);
      await enrollPlayers(other.tournament.id, other.category.id, 4);
      await startTournament(mine.tournament.id);
      await startTournament(other.tournament.id);
      const { token, user } = await sessionWithRole(app);
      await grantScopedRole(user.id, 'CHIEF_ARBITER', 'TOURNAMENT', mine.tournament.id);

      await generate(token, mine.tournament.id).expect(201);
      const res = await generate(token, other.tournament.id).expect(403);
      expect(res.body.code).toBe('OUT_OF_SCOPE');
      expect(await prisma.round.count({ where: { tournamentId: other.tournament.id } })).toBe(0);
    });

    it('404 con un torneo inexistente o un id malformado', async () => {
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      await generate(token, MISSING).expect(404);
      await generate(token, 'no-es-uuid').expect(404);
    });
  });

  describe('ronda 1', () => {
    it('201: crea la ronda en curso con mesas AUTO y una partida pendiente por mesa', async () => {
      const { tournament, category } = await makeTournamentWithCategory();
      const players = await enrollPlayers(tournament.id, category.id, 8);
      await startTournament(tournament.id);
      const { token } = await sessionWithRole(app, 'CHIEF_ARBITER');

      const res = await generate(token, tournament.id).expect(201);

      expect(res.body).toMatchObject({ tournamentId: tournament.id, number: 1, status: 'IN_PROGRESS' });
      expect(res.body.startedAt).toBeTruthy();
      expect(res.body.pairings).toHaveLength(4);
      expect(res.body.pairings.map((p: { board: number }) => p.board)).toEqual([1, 2, 3, 4]);
      expect(res.body.pairings.every((p: { origin: string }) => p.origin === 'AUTO')).toBe(true);

      // Mesa 1: el mejor contra el primero de la mitad inferior
      const first = res.body.pairings[0];
      expect([first.whitePlayerId, first.blackPlayerId].sort()).toEqual([players[0]!.id, players[4]!.id].sort());

      const games = await prisma.game.findMany({ where: { tournamentId: tournament.id } });
      expect(games).toHaveLength(4);
      expect(games.every((g) => g.result === 'PENDING' && g.pairingId !== null)).toBe(true);
    });

    it('con número impar crea un descanso sin partida', async () => {
      const { tournament, category } = await makeTournamentWithCategory();
      const players = await enrollPlayers(tournament.id, category.id, 9);
      await startTournament(tournament.id);
      const { token } = await sessionWithRole(app, 'CHIEF_ARBITER');

      const res = await generate(token, tournament.id).expect(201);

      expect(res.body.pairings).toHaveLength(5);
      const bye = res.body.pairings.find((p: { isBye: boolean }) => p.isBye);
      expect(bye).toMatchObject({ whitePlayerId: players[8]!.id, blackPlayerId: null });
      expect(await prisma.game.count({ where: { tournamentId: tournament.id } })).toBe(4);
    });

    it('ignora las inscripciones canceladas', async () => {
      const { tournament, category } = await makeTournamentWithCategory();
      await enrollPlayers(tournament.id, category.id, 4);
      await prisma.registration.updateMany({
        where: { tournamentId: tournament.id, folio: { in: [3, 4] } },
        data: { status: 'CANCELLED' },
      });
      await startTournament(tournament.id);
      const { token } = await sessionWithRole(app, 'CHIEF_ARBITER');

      const res = await generate(token, tournament.id).expect(201);
      expect(res.body.pairings).toHaveLength(1);
    });

    it('409 NOT_ENOUGH_PLAYERS con menos de 2 inscripciones activas y no crea nada', async () => {
      const { tournament, category } = await makeTournamentWithCategory({ status: 'IN_PROGRESS' });
      const { token } = await sessionWithRole(app, 'CHIEF_ARBITER');

      const none =await generate(token, tournament.id).expect(409);
      expect(none.body.code).toBe('NOT_ENOUGH_PLAYERS');

      await enrollPlayers(tournament.id, category.id, 1);
      await generate(token, tournament.id).expect(409);
      expect(await prisma.round.count()).toBe(0);
    });

    it('409 TOURNAMENT_NOT_EDITABLE si el torneo ya terminó', async () => {
      const { tournament, category } = await makeTournamentWithCategory({ status: 'FINISHED' });
      await enrollPlayers(tournament.id, category.id, 4);
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const res = await generate(token, tournament.id).expect(409);
      expect(res.body.code).toBe('TOURNAMENT_NOT_EDITABLE');
    });
  });

  describe('rondas siguientes y cierre de la anterior', () => {
    it('409 PREVIOUS_ROUND_UNFINISHED con partidas sin resultado y nada cambia', async () => {
      const { tournament, category } = await makeTournamentWithCategory();
      await enrollPlayers(tournament.id, category.id, 4);
      await startTournament(tournament.id);
      const { token } = await sessionWithRole(app, 'CHIEF_ARBITER');
      await generate(token, tournament.id).expect(201);

      const res = await generate(token, tournament.id).expect(409);
      expect(res.body.code).toBe('PREVIOUS_ROUND_UNFINISHED');

      const rounds = await prisma.round.findMany({ where: { tournamentId: tournament.id } });
      expect(rounds).toHaveLength(1);
      expect(rounds[0]).toMatchObject({ status: 'IN_PROGRESS', finishedAt: null });
    });

    it('con todas las partidas resueltas cierra la ronda 1 y abre la 2 sin repetir rivales', async () => {
      const { tournament, category } = await makeTournamentWithCategory();
      await enrollPlayers(tournament.id, category.id, 8);
      await startTournament(tournament.id);
      const { token } = await sessionWithRole(app, 'CHIEF_ARBITER');
      const first =await generate(token, tournament.id).expect(201);
      await finishRoundGames(tournament.id, 1);

      const second = await generate(token, tournament.id).expect(201);
      expect(second.body).toMatchObject({ number: 2, status: 'IN_PROGRESS' });

      const [round1, round2] = await Promise.all([
        prisma.round.findUniqueOrThrow({ where: { tournamentId_number: { tournamentId: tournament.id, number: 1 } } }),
        prisma.round.findUniqueOrThrow({ where: { tournamentId_number: { tournamentId: tournament.id, number: 2 } } }),
      ]);
      expect(round1.status).toBe('FINISHED');
      expect(round1.finishedAt).toBeTruthy();
      expect(round2.status).toBe('IN_PROGRESS');

      const key = (p: { whitePlayerId: string; blackPlayerId: string | null }) =>
        [p.whitePlayerId, p.blackPlayerId].sort().join('|');
      const before = new Set(first.body.pairings.map(key));
      for (const pairing of second.body.pairings) expect(before.has(key(pairing))).toBe(false);
    });

    it('409 ROUNDS_COMPLETE cuando ya están todas las rondas planeadas', async () => {
      const { tournament, category } = await makeTournamentWithCategory({ roundsPlanned: 1 });
      await enrollPlayers(tournament.id, category.id, 4);
      await startTournament(tournament.id);
      const { token } = await sessionWithRole(app, 'CHIEF_ARBITER');
      await generate(token, tournament.id).expect(201);
      await finishRoundGames(tournament.id, 1);

      const res = await generate(token, tournament.id).expect(409);
      expect(res.body.code).toBe('ROUNDS_COMPLETE');
    });

    it('409 ROUND_DUPLICATE si el número siguiente lo ocupa una ronda inactiva', async () => {
      const { tournament, category } = await makeTournamentWithCategory();
      await enrollPlayers(tournament.id, category.id, 4);
      await startTournament(tournament.id);
      const { token } = await sessionWithRole(app, 'CHIEF_ARBITER');
      await generate(token, tournament.id).expect(201);
      await finishRoundGames(tournament.id, 1);
      await makeRound(tournament.id, 2, { isActive: false });

      const res = await generate(token, tournament.id).expect(409);
      expect(res.body.code).toBe('ROUND_DUPLICATE');
    });

    it('409 PREVIOUS_ROUND_UNFINISHED si la ronda anterior (manual) no tiene mesas', async () => {
      const { tournament, category } = await makeTournamentWithCategory();
      await enrollPlayers(tournament.id, category.id, 4);
      await makeRound(tournament.id, 1);
      await startTournament(tournament.id);
      const { token } = await sessionWithRole(app, 'CHIEF_ARBITER');

      const res = await generate(token, tournament.id).expect(409);
      expect(res.body.code).toBe('PREVIOUS_ROUND_UNFINISHED');
    });
  });

  describe('estado del torneo (RF19, P-44)', () => {
    it.each(['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'] as const)(
      '409 TOURNAMENT_NOT_IN_PROGRESS en %s: aún no inicia y no crea nada',
      async (status) => {
        const { tournament, category } = await makeTournamentWithCategory({ status });
        await enrollPlayers(tournament.id, category.id, 4);
        const { token } = await sessionWithRole(app, 'CHIEF_ARBITER');

        const res = await generate(token, tournament.id).expect(409);

        expect(res.body.code).toBe('TOURNAMENT_NOT_IN_PROGRESS');
        expect(res.body.message).toMatch(/aún no inicia/);
        expect(await prisma.round.count({ where: { tournamentId: tournament.id } })).toBe(0);
      },
    );

    it('409 TOURNAMENT_NOT_IN_PROGRESS en ROUND_IN_PROGRESS con mensaje de ronda en curso', async () => {
      const { tournament, category } = await makeTournamentWithCategory({ status: 'ROUND_IN_PROGRESS' });
      await enrollPlayers(tournament.id, category.id, 4);
      const { token } = await sessionWithRole(app, 'CHIEF_ARBITER');

      const res = await generate(token, tournament.id).expect(409);

      expect(res.body.code).toBe('TOURNAMENT_NOT_IN_PROGRESS');
      expect(res.body.message).toMatch(/ronda en curso/);
      expect(await prisma.round.count({ where: { tournamentId: tournament.id } })).toBe(0);
    });

    it.each(['FINISHED', 'CANCELLED'] as const)('los estados finales siguen en TOURNAMENT_NOT_EDITABLE (%s)', async (status) => {
      const { tournament, category } = await makeTournamentWithCategory({ status });
      await enrollPlayers(tournament.id, category.id, 4);
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');

      const res = await generate(token, tournament.id).expect(409);

      expect(res.body.code).toBe('TOURNAMENT_NOT_EDITABLE');
    });
  });
});
