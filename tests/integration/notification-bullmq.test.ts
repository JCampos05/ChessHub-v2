import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BullNotificationQueue, redisConnectionOptions } from '../../src/lib/queue-bullmq.js';
import type { NotificationJob } from '../../src/lib/queue.js';
import { notificationRepository } from '../../src/modules/notifications/notification.repository.js';
import { processNotification } from '../../src/modules/notifications/notification.worker.js';
import { prisma, resetDb } from '../helpers/db.js';
import { makeTournament } from '../helpers/factories.js';

const REDIS_URL = process.env['TEST_REDIS_URL'];
const job = (): NotificationJob => ({ changeId: randomUUID(), tournamentId: randomUUID() });

describe('conexión de BullMQ (RNF06, ADR-015)', () => {
  it('deriva las opciones de REDIS_URL', () => {
    expect(redisConnectionOptions('redis://localhost:6379')).toEqual({ host: 'localhost', port: 6379 });
    expect(redisConnectionOptions('rediss://user:p%40ss@cache.example.com:6380/2')).toEqual({
      host: 'cache.example.com',
      port: 6380,
      username: 'user',
      password: 'p@ss',
      db: 2,
      tls: {},
    });
  });

  it('con Redis inalcanzable, encolar falla en menos de 3 s con QUEUE_UNAVAILABLE', async () => {
    const queue = new BullNotificationQueue({ redisUrl: 'redis://127.0.0.1:1', attempts: 2, backoffMs: 10 });
    const started = Date.now();

    await expect(queue.enqueue(job())).rejects.toMatchObject({ statusCode: 503, code: 'QUEUE_UNAVAILABLE' });

    expect(Date.now() - started).toBeLessThan(3_000);
    await queue.close();
  }, 10_000);
});

describe.skipIf(!REDIS_URL)('cola BullMQ con Redis real (RF22, RNF06, ADR-015)', () => {
  let queue: BullNotificationQueue;

  beforeEach(async () => {
    await resetDb();
    queue = new BullNotificationQueue({
      redisUrl: REDIS_URL!,
      attempts: 2,
      backoffMs: 20,
      queueName: `notifications-test-${randomUUID()}`,
    });
  });
  afterEach(async () => {
    await queue.purge();
    await queue.close();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('un trabajo se encola y se consume creando la notificación', async () => {
    const user = await prisma.user.create({
      data: { email: `bull-${randomUUID()}@prueba.test`, passwordHash: 'x', fullName: 'Creador' },
    });
    const tournament = await makeTournament({ status: 'REGISTRATION_CLOSED', createdById: user.id });
    const change = await prisma.stateChange.create({
      data: {
        entityType: 'TOURNAMENT',
        entityId: tournament.id,
        fromState: 'REGISTRATION_OPEN',
        toState: 'REGISTRATION_CLOSED',
        changedById: user.id,
      },
    });
    const mail = { send: vi.fn() };

    await queue.startConsumer((payload) =>
      processNotification(payload, { repo: notificationRepository, mail, mailEnabled: false }),
    );
    await queue.enqueue({ changeId: change.id, tournamentId: tournament.id });

    await vi.waitFor(async () => expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(1), {
      timeout: 5_000,
    });
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('un fallo se reintenta y el trabajo termina', async () => {
    const handler = vi.fn().mockRejectedValueOnce(new Error('aún no visible')).mockResolvedValue(undefined);

    await queue.startConsumer(handler);
    await queue.enqueue(job());

    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2), { timeout: 5_000 });
    expect(await queue.failed()).toEqual([]);
  });

  it('un trabajo agotado queda en la lista de fallidos', async () => {
    const payload = job();
    const handler = vi.fn().mockRejectedValue(new Error('siempre falla'));

    await queue.startConsumer(handler);
    await queue.enqueue(payload);

    await vi.waitFor(async () => expect(await queue.failed()).toHaveLength(1), { timeout: 5_000 });
    const [failed] = await queue.failed();
    expect(failed).toMatchObject({ job: payload, attempts: 2, error: 'siempre falla' });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('encolar dos veces el mismo cambio lo procesa una sola vez', async () => {
    const payload = job();
    const handler = vi.fn().mockResolvedValue(undefined);

    await queue.startConsumer(handler);
    await queue.enqueue(payload);
    await queue.enqueue(payload);

    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1), { timeout: 5_000 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
