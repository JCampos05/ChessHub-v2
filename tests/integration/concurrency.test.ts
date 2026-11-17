import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { roundGenerationRepository } from '../../src/modules/rounds/round-generation.repository.js';
import { bearer, sessionWithRole } from '../helpers/auth.js';
import { prisma, resetDb } from '../helpers/db.js';
import { makePlayer } from '../helpers/factories.js';
import {
  enrollPlayers,
  finishRoundGames,
  makeTournamentWithCategory,
  startTournament,
} from '../helpers/registrations.js';

const app = createApp();
const LONG = 60_000;

// Concurrencia y atomicidad de las operaciones críticas 
describe('concurrencia y atomicidad', () => {
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const register = (token: string, tournamentId: string, playerId: string, categoryId: string) =>
    request(app)
      .post(`/api/v1/torneos/${tournamentId}/inscripciones`)
      .set(...bearer(token))
      .send({ playerId, categoryId });

  const generate = (token: string, tournamentId: string) =>
    request(app)
      .post(`/api/v1/torneos/${tournamentId}/rondas/generar`)
      .set(...bearer(token))
      .send({});

  describe('inscripciones', () => {
    it('RF18: 20 peticiones por el último cupo dan 1 respuesta 201 y 19 respuestas 409', async () => {
      // Cupo de 2 (el mínimo permitido) con una plaza ya ocupada: queda una
      const { tournament, category } = await makeTournamentWithCategory({ maxPlayers: 2 });
      const { token } = await sessionWithRole(app, 'ORGANIZER');
      const players = await Promise.all(Array.from({ length: 21 }, () => makePlayer()));
      await register(token, tournament.id, players[0]!.id, category.id).expect(201);

      const responses = await Promise.all(
        players.slice(1).map((player) => register(token, tournament.id, player.id, category.id)),
      );

      const statuses = responses.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(19);
      expect(responses.filter((r) => r.status === 409).every((r) => r.body.code === 'CAPACITY_FULL')).toBe(true);

      const stored = await prisma.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
      expect(stored.registeredCount).toBe(2);
      expect(stored.registeredCount).toBeLessThanOrEqual(stored.maxPlayers!);
      // Los rechazos no consumen folio
      expect(stored.registrationCounter).toBe(2);
      expect(await prisma.registration.count({ where: { tournamentId: tournament.id } })).toBe(2);
    }, LONG);

    it('RF17: 50 inscripciones simultáneas reciben los folios 1 a 50 sin repetir ni dejar huecos', async () => {
      const { tournament, category } = await makeTournamentWithCategory();
      const { token } = await sessionWithRole(app, 'ORGANIZER');
      const players = await Promise.all(Array.from({ length: 50 }, () => makePlayer()));

      const responses = await Promise.all(
        players.map((player) => register(token, tournament.id, player.id, category.id)),
      );

      expect(responses.every((r) => r.status === 201)).toBe(true);
      const folios = responses.map((r) => r.body.folio as number).sort((a, b) => a - b);
      expect(folios).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));

      const stored = await prisma.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
      expect(stored).toMatchObject({ registeredCount: 50, registrationCounter: 50 });
    }, LONG);

    it('RNF03: inscribir al mismo jugador 10 veces a la vez deja una inscripción y revierte el resto', async () => {
      const { tournament, category } = await makeTournamentWithCategory({ maxPlayers: 10 });
      const { token } = await sessionWithRole(app, 'ORGANIZER');
      const player = await makePlayer();

      const responses = await Promise.all(
        Array.from({ length: 10 }, () => register(token, tournament.id, player.id, category.id)),
      );

      expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
      expect(responses.filter((r) => r.status === 409)).toHaveLength(9);
      expect(responses.filter((r) => r.status === 409).every((r) => r.body.code === 'ALREADY_REGISTERED')).toBe(true);

      // Los intentos fallidos reservaron cupo y folio dentro de su transacción, y todo se revirtió
      const stored = await prisma.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
      expect(stored).toMatchObject({ registeredCount: 1, registrationCounter: 1 });
      expect(await prisma.registration.count({ where: { tournamentId: tournament.id } })).toBe(1);
    }, LONG);

    it('cancelaciones y altas simultáneas dejan el contador igual a las inscripciones activas', async () => {
      const { tournament, category } = await makeTournamentWithCategory({ maxPlayers: 30 });
      const { token } = await sessionWithRole(app, 'ORGANIZER');
      const first = await Promise.all(Array.from({ length: 10 }, () => makePlayer()));
      const created = await Promise.all(first.map((p) => register(token, tournament.id, p.id, category.id)));
      const more = await Promise.all(Array.from({ length: 10 }, () => makePlayer()));

      await Promise.all([
        ...created.slice(0, 5).map((r) =>
          request(app)
            .delete(`/api/v1/torneos/${tournament.id}/inscripciones/${r.body.id}`)
            .set(...bearer(token)),
        ),
        ...more.map((p) => register(token, tournament.id, p.id, category.id)),
      ]);

      const active = await prisma.registration.count({ where: { tournamentId: tournament.id, status: 'ACTIVE' } });
      const stored = await prisma.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
      expect(active).toBe(15);
      expect(stored.registeredCount).toBe(active);
      expect(stored.registrationCounter).toBe(20);
    }, LONG);
  });

  describe('generación de rondas', () => {
    it('RF17: cinco generaciones simultáneas de la misma ronda dan una sola respuesta 201', async () => {
      const { tournament, category } = await makeTournamentWithCategory();
      await enrollPlayers(tournament.id, category.id, 8);
      await startTournament(tournament.id);
      const { token } = await sessionWithRole(app, 'CHIEF_ARBITER');

      const responses =await Promise.all(Array.from({ length: 5 }, () => generate(token, tournament.id)));

      expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
      const rejected = responses.filter((r) => r.status !== 201);
      expect(rejected.every((r) => r.status === 409)).toBe(true);
      expect(rejected.every((r) => ['PREVIOUS_ROUND_UNFINISHED', 'ROUND_DUPLICATE'].includes(r.body.code))).toBe(true);

      expect(await prisma.round.count({ where: { tournamentId: tournament.id } })).toBe(1);
      expect(await prisma.pairing.count({ where: { tournamentId: tournament.id } })).toBe(4);
      expect(await prisma.game.count({ where: { tournamentId: tournament.id } })).toBe(4);
    }, LONG);

    it('generar y cancelar una inscripción a la vez no deja una ronda con jugadores a medias', async () => {
      const { tournament, category } = await makeTournamentWithCategory();
      const players = await enrollPlayers(tournament.id, category.id, 8);
      await startTournament(tournament.id);
      const { token } = await sessionWithRole(app, 'CHIEF_ARBITER');
      const toCancel = await prisma.registration.findMany({
        where: { tournamentId: tournament.id, folio: { in: [7, 8] } },
        select: { id: true },
      });

      const [gen, ...cancels] = await Promise.all([
        generate(token, tournament.id),
        ...toCancel.map((r) =>
          request(app)
            .delete(`/api/v1/torneos/${tournament.id}/inscripciones/${r.id}`)
            .set(...bearer(token)),
        ),
      ]);

      expect(gen.status).toBe(201);
      expect(cancels.every((c) => c.status < 300)).toBe(true);
      // Cada jugador aparece una sola vez; la ronda ve las inscripciones antes o después de cada cancelación, nunca a medias
      const ids = (gen.body.pairings as { whitePlayerId: string; blackPlayerId: string | null }[]).flatMap((p) =>
        p.blackPlayerId === null ? [p.whitePlayerId] : [p.whitePlayerId, p.blackPlayerId],
      );
      expect(new Set(ids).size).toBe(ids.length);
      const stillActive = (
        await prisma.registration.findMany({ where: { tournamentId: tournament.id, status: 'ACTIVE' } })
      ).map((r) => r.playerId);
      expect(stillActive).toHaveLength(6);
      expect(stillActive.every((id) => ids.includes(id))).toBe(true);
      const enrolled = new Set(players.map((p) => p.id));
      expect(ids.every((id) => enrolled.has(id))).toBe(true);
    }, LONG);
  });

  describe('rollback (RNF03)', () => {
    it('un fallo al crear una mesa de la ronda 1 no deja ronda, mesas ni partidas', async () => {
      const { tournament, category } = await makeTournamentWithCategory();
      await enrollPlayers(tournament.id, category.id, 8);
      await startTournament(tournament.id);
      const { token } = await sessionWithRole(app, 'CHIEF_ARBITER');

      const original = roundGenerationRepository.createPairing;
      let calls = 0;
      const spy = vi.spyOn(roundGenerationRepository, 'createPairing').mockImplementation((...args) => {
        calls += 1;
        // La primera mesa se crea; la segunda falla
        if (calls === 2) return Promise.reject(new Error('fallo forzado')) as unknown as ReturnType<typeof original>;
        return original(...args);
      });
      try {
        await generate(token, tournament.id).expect(500);
      } finally {
        spy.mockRestore();
      }

      expect(calls).toBe(2);
      expect(await prisma.round.count({ where: { tournamentId: tournament.id } })).toBe(0);
      expect(await prisma.pairing.count({ where: { tournamentId: tournament.id } })).toBe(0);
      expect(await prisma.game.count({ where: { tournamentId: tournament.id } })).toBe(0);

      // Sin el fallo, la misma petición funciona: nada quedó bloqueado ni a medias
      await generate(token, tournament.id).expect(201);
    }, LONG);

    it('un fallo en la ronda 2 deja la ronda 1 sin cerrar y sin ronda 2', async () => {
      const { tournament, category } = await makeTournamentWithCategory();
      await enrollPlayers(tournament.id, category.id, 8);
      await startTournament(tournament.id);
      const { token } = await sessionWithRole(app, 'CHIEF_ARBITER');
      await generate(token, tournament.id).expect(201);
      await finishRoundGames(tournament.id, 1);

      const original = roundGenerationRepository.createPairing;
      let calls = 0;
      const spy = vi.spyOn(roundGenerationRepository, 'createPairing').mockImplementation((...args) => {
        calls += 1;
        if (calls === 3) return Promise.reject(new Error('fallo forzado')) as unknown as ReturnType<typeof original>;
        return original(...args);
      });
      try {
        await generate(token, tournament.id).expect(500);
      } finally {
        spy.mockRestore();
      }

      const rounds = await prisma.round.findMany({ where: { tournamentId: tournament.id }, orderBy: { number: 'asc' } });
      expect(rounds).toHaveLength(1);
      // El cierre de la ronda 1 se revirtió junto con todo lo demás
      expect(rounds[0]).toMatchObject({ number: 1, status: 'IN_PROGRESS', finishedAt: null });
      expect(await prisma.pairing.count({ where: { tournamentId: tournament.id, roundNumber: 2 } })).toBe(0);
      expect(await prisma.game.count({ where: { tournamentId: tournament.id, roundNumber: 2 } })).toBe(0);

      await generate(token, tournament.id).expect(201);
    }, LONG);

    it('una inscripción rechazada por duplicado no consume cupo ni folio', async () => {
      const { tournament, category } = await makeTournamentWithCategory({ maxPlayers: 4 });
      const { token } = await sessionWithRole(app, 'ORGANIZER');
      const player = await makePlayer();
      const other = await makePlayer();

      await register(token, tournament.id, player.id, category.id).expect(201);
      await register(token, tournament.id, player.id, category.id).expect(409);
      const next = await register(token, tournament.id, other.id, category.id).expect(201);

      // Sin huecos: el siguiente folio es el 2, no el 3
      expect(next.body.folio).toBe(2);
    }, LONG);
  });
});
