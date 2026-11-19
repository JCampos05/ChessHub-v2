import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { getNotificationQueue } from '../../src/lib/queue.js';
import { tournamentStateRepository } from '../../src/modules/tournaments/state/tournament-state.repository.js';
import { bearer, sessionWithRole } from '../helpers/auth.js';
import { prisma, resetDb } from '../helpers/db.js';
import { enrollPlayers, makeManualRound, makeTournamentWithCategory } from '../helpers/registrations.js';

const app = createApp();

describe('reversión de cambios de estado (RF21, RNF03, ADR-017)', () => {
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const setState = (token: string, tournamentId: string, estado: string) =>
    request(app).patch(`/api/v1/torneos/${tournamentId}/estado`).set(...bearer(token)).send({ estado });
  const statusOf = async (id: string) => (await prisma.tournament.findUniqueOrThrow({ where: { id } })).status;
  const roundOf = (tournamentId: string) =>
    prisma.round.findUniqueOrThrow({ where: { tournamentId_number: { tournamentId, number: 1 } } });

  async function withPendingRound() {
    const { tournament, category } = await makeTournamentWithCategory({ status: 'IN_PROGRESS' });
    const [white, black] = await enrollPlayers(tournament.id, category.id, 4);
    await makeManualRound(tournament.id, white!.id, black!.id);
    return tournament;
  }

  async function withRunningRound() {
    const { tournament, category } = await makeTournamentWithCategory({ status: 'ROUND_IN_PROGRESS' });
    const [white, black] = await enrollPlayers(tournament.id, category.id, 4);
    await makeManualRound(tournament.id, white!.id, black!.id, { status: 'IN_PROGRESS', result: 'WHITE_WINS' });
    return tournament;
  }

  describe('si falla el encolado', () => {
    it('503: el estado queda igual y no hay fila de historial', async () => {
      const { tournament } = await makeTournamentWithCategory({ status: 'REGISTRATION_OPEN' });
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const enqueue = vi.spyOn(getNotificationQueue(), 'enqueue').mockRejectedValueOnce(new Error('redis caído'));

      try {
        const res = await setState(token, tournament.id, 'REGISTRATION_CLOSED').expect(503);
        expect(res.body.code).toBe('QUEUE_UNAVAILABLE');
      } finally {
        enqueue.mockRestore();
      }

      expect(await statusOf(tournament.id)).toBe('REGISTRATION_OPEN');
      expect(await prisma.stateChange.count()).toBe(0);
    });

    it('revierte el inicio de la ronda (estado y started_at)', async () => {
      const tournament = await withPendingRound();
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const enqueue = vi.spyOn(getNotificationQueue(), 'enqueue').mockRejectedValueOnce(new Error('redis caído'));

      try {
        await setState(token, tournament.id, 'ROUND_IN_PROGRESS').expect(503);
      } finally {
        enqueue.mockRestore();
      }

      expect(await statusOf(tournament.id)).toBe('IN_PROGRESS');
      expect(await roundOf(tournament.id)).toMatchObject({ status: 'PENDING', startedAt: null });
      expect(await prisma.stateChange.count()).toBe(0);
    });

    it('revierte el cierre de la ronda (estado y finished_at)', async () => {
      const tournament = await withRunningRound();
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const enqueue = vi.spyOn(getNotificationQueue(), 'enqueue').mockRejectedValueOnce(new Error('redis caído'));

      try {
        await setState(token, tournament.id, 'IN_PROGRESS').expect(503);
      } finally {
        enqueue.mockRestore();
      }

      expect(await statusOf(tournament.id)).toBe('ROUND_IN_PROGRESS');
      expect(await roundOf(tournament.id)).toMatchObject({ status: 'IN_PROGRESS', finishedAt: null });
      expect(await prisma.stateChange.count()).toBe(0);
    });
  });

  describe('si falla la escritura del historial', () => {
    it('500: el estado queda igual y no se encola nada', async () => {
      const { tournament } = await makeTournamentWithCategory({ status: 'REGISTRATION_OPEN' });
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const createChange = vi
        .spyOn(tournamentStateRepository, 'createChange')
        .mockRejectedValueOnce(new Error('fallo al escribir el historial'));
      const enqueue = vi.spyOn(getNotificationQueue(), 'enqueue');

      try {
        await setState(token, tournament.id, 'REGISTRATION_CLOSED').expect(500);
        expect(enqueue).not.toHaveBeenCalled();
      } finally {
        createChange.mockRestore();
        enqueue.mockRestore();
      }

      expect(await statusOf(tournament.id)).toBe('REGISTRATION_OPEN');
      expect(await prisma.stateChange.count()).toBe(0);
    });

    it('revierte también el efecto sobre la ronda', async () => {
      const tournament = await withPendingRound();
      const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
      const createChange = vi
        .spyOn(tournamentStateRepository, 'createChange')
        .mockRejectedValueOnce(new Error('fallo al escribir el historial'));

      try {
        await setState(token, tournament.id, 'ROUND_IN_PROGRESS').expect(500);
      } finally {
        createChange.mockRestore();
      }

      expect(await statusOf(tournament.id)).toBe('IN_PROGRESS');
      expect(await roundOf(tournament.id)).toMatchObject({ status: 'PENDING', startedAt: null });
    });
  });

  it('tras un fallo revertido, el mismo cambio se puede repetir y se aplica una sola vez', async () => {
    const { tournament } = await makeTournamentWithCategory({ status: 'REGISTRATION_OPEN' });
    const { token } = await sessionWithRole(app, 'FEDERATION_ADMIN');
    const enqueue = vi.spyOn(getNotificationQueue(), 'enqueue').mockRejectedValueOnce(new Error('redis caído'));

    try {
      await setState(token, tournament.id, 'REGISTRATION_CLOSED').expect(503);
    } finally {
      enqueue.mockRestore();
    }
    await setState(token, tournament.id, 'REGISTRATION_CLOSED').expect(200);

    expect(await statusOf(tournament.id)).toBe('REGISTRATION_CLOSED');
    expect(await prisma.stateChange.count()).toBe(1);
  });
});
