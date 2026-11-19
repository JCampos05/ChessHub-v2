import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { getNotificationQueue } from '../../src/lib/queue.js';
import { bearer, sessionWithRole } from '../helpers/auth.js';
import { prisma, resetDb } from '../helpers/db.js';
import { makePlayer, makeRound } from '../helpers/factories.js';
import { enrollPlayers, makeTournamentWithCategory } from '../helpers/registrations.js';

const app = createApp();

describe('concurrencia de cambios de estado (RF20, RNF03)', () => {
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const setState = (token: string, tournamentId: string, estado: string) =>
    request(app).patch(`/api/v1/torneos/${tournamentId}/estado`).set(...bearer(token)).send({ estado });
  const historyRows = (tournamentId: string) => prisma.stateChange.findMany({ where: { entityId: tournamentId } });

  it('20 peticiones simultáneas a la misma transición dan 1×200 y 19×422, con una fila de historial y un trabajo', async () => {
    const { tournament, category } = await makeTournamentWithCategory({ status: 'REGISTRATION_OPEN' });
    await enrollPlayers(tournament.id, category.id, 4);
    const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
    const enqueue = vi.spyOn(getNotificationQueue(), 'enqueue');

    try {
      const responses = await Promise.all(
        Array.from({ length: 20 }, () => setState(token, tournament.id, 'REGISTRATION_CLOSED')),
      );

      expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
      const rejected = responses.filter((r) => r.status !== 200);
      expect(rejected).toHaveLength(19);
      expect(rejected.every((r) => r.status === 422 && r.body.code === 'INVALID_STATE_TRANSITION')).toBe(true);
      expect(await historyRows(tournament.id)).toHaveLength(1);
      expect(enqueue).toHaveBeenCalledTimes(1);
    } finally {
      enqueue.mockRestore();
    }
    const stored = await prisma.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
    expect(stored.status).toBe('REGISTRATION_CLOSED');
  }, 30_000);

  it('una cancelación y una finalización simultáneas terminan en un estado final con una sola fila de historial', async () => {
    const { tournament, category } = await makeTournamentWithCategory({ status: 'IN_PROGRESS' });
    await enrollPlayers(tournament.id, category.id, 4);
    await makeRound(tournament.id, 1, { status: 'FINISHED', startedAt: new Date(), finishedAt: new Date() });
    const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');

    const [cancel, finish] = await Promise.all([
      setState(token, tournament.id, 'CANCELLED'),
      setState(token, tournament.id, 'FINISHED'),
    ]);

    expect([cancel.status, finish.status].sort()).toEqual([200, 422]);
    const winner = cancel.status === 200 ? 'CANCELLED' : 'FINISHED';
    const stored = await prisma.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
    expect(stored.status).toBe(winner);
    const rows = await historyRows(tournament.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fromState: 'IN_PROGRESS', toState: winner });
  }, 30_000);

  it('una inscripción simultánea con el cierre recibe 201 antes del cierre o REGISTRATION_CLOSED después, sin descuadrar el conteo', async () => {
    const { tournament, category } = await makeTournamentWithCategory({ status: 'REGISTRATION_OPEN', maxPlayers: 50 });
    const admin = await sessionWithRole(app, 'FEDERATION_ADMIN');
    const organizer = await sessionWithRole(app, 'ORGANIZER');
    const players = await Promise.all(Array.from({ length: 12 }, () => makePlayer()));

    const [close, ...registrations] = await Promise.all([
      setState(admin.token, tournament.id, 'REGISTRATION_CLOSED'),
      ...players.map((player) =>
        request(app)
          .post(`/api/v1/torneos/${tournament.id}/inscripciones`)
          .set(...bearer(organizer.token))
          .send({ playerId: player.id, categoryId: category.id }),
      ),
    ]);

    expect(close.status).toBe(200);
    const created = registrations.filter((r) => r.status === 201);
    const refused = registrations.filter((r) => r.status !== 201);
    expect(refused.every((r) => r.status === 409 && r.body.code === 'REGISTRATION_CLOSED')).toBe(true);

    const stored = await prisma.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
    const active = await prisma.registration.findMany({ where: { tournamentId: tournament.id, status: 'ACTIVE' } });
    expect(stored.status).toBe('REGISTRATION_CLOSED');
    expect(active).toHaveLength(created.length);
    expect(stored.registeredCount).toBe(created.length);
    expect(new Set(active.map((r) => r.folio)).size).toBe(active.length);
  }, 30_000);
});
