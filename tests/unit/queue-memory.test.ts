import { describe, expect, it, vi } from 'vitest';
import { closeNotificationQueue, getNotificationQueue, type NotificationJob } from '../../src/lib/queue.js';
import { MemoryNotificationQueue } from '../../src/lib/queue-memory.js';
import { AppError } from '../../src/shared/errors.js';

const job = (n = 1): NotificationJob => ({ changeId: `cambio-${n}`, tournamentId: 'torneo-1' });

// Las esperas se registran y se cumplen de inmediato: la prueba no depende del reloj
function makeQueue(attempts = 3) {
  const delays: number[] = [];
  const log = { error: vi.fn() };
  const queue = new MemoryNotificationQueue({
    attempts,
    backoffMs: 10,
    log,
    schedule: (run, delayMs) => {
      delays.push(delayMs);
      queueMicrotask(run);
      return () => undefined;
    },
  });
  return { queue, delays, log };
}

describe('cola de notificaciones en memoria (RF22, RNF06)', () => {
  it('un trabajo que falla dos veces y luego pasa se reintenta con esperas crecientes', async () => {
    const { queue, delays, log } = makeQueue();
    let calls = 0;
    await queue.startConsumer(async () => {
      calls += 1;
      if (calls < 3) throw new Error('todavía no');
    });

    await queue.enqueue(job());
    await queue.drain();

    expect(calls).toBe(3);
    expect(delays).toEqual([10, 20]);
    expect(queue.failed()).toEqual([]);
    expect(log.error).not.toHaveBeenCalled();
  });

  it('un trabajo que agota los intentos queda en fallidos y se registra', async () => {
    const { queue, delays, log } = makeQueue();
    const handler = vi.fn().mockRejectedValue(new Error('sin cambio'));
    await queue.startConsumer(handler);

    await queue.enqueue(job(7));
    await queue.drain();

    expect(handler).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([10, 20]);
    expect(queue.failed()).toEqual([{ job: job(7), attempts: 3, error: 'sin cambio' }]);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0]?.[0]).toMatchObject({ changeId: 'cambio-7', attempts: 3 });
  });

  it('un fallo no detiene a los demás trabajos', async () => {
    const { queue } = makeQueue(1);
    const done: string[] = [];
    await queue.startConsumer(async (received) => {
      if (received.changeId === 'cambio-2') throw new Error('falla este');
      done.push(received.changeId);
    });

    await Promise.all([1, 2, 3].map((n) => queue.enqueue(job(n))));
    await queue.drain();

    expect(done.sort()).toEqual(['cambio-1', 'cambio-3']);
    expect(queue.failed()).toHaveLength(1);
  });

  it('drain espera a que termine todo, reintentos incluidos', async () => {
    const { queue } = makeQueue();
    const finished: number[] = [];
    await queue.startConsumer(async (received) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      finished.push(Number(received.changeId.split('-')[1]));
    });

    for (const n of [1, 2, 3]) await queue.enqueue(job(n));
    expect(finished).toEqual([]);
    await queue.drain();

    expect(finished.sort()).toEqual([1, 2, 3]);
  });

  it('encolar devuelve el control antes de procesar', async () => {
    const { queue } = makeQueue();
    const handler = vi.fn().mockResolvedValue(undefined);
    await queue.startConsumer(handler);

    const pending = queue.enqueue(job());
    expect(handler).not.toHaveBeenCalled();
    await pending;
    await queue.drain();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(job());
  });

  it('los trabajos encolados antes del consumidor se procesan al registrarlo', async () => {
    const { queue } = makeQueue();
    await queue.enqueue(job(1));
    await queue.enqueue(job(2));
    await queue.drain();

    const handler = vi.fn().mockResolvedValue(undefined);
    await queue.startConsumer(handler);
    await queue.drain();

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('no admite un segundo consumidor', async () => {
    const { queue } = makeQueue();
    await queue.startConsumer(async () => undefined);

    await expect(queue.startConsumer(async () => undefined)).rejects.toThrow(/ya tiene un consumidor/);
  });

  it('encolar con la cola cerrada lanza QUEUE_UNAVAILABLE (503)', async () => {
    const { queue } = makeQueue();
    await queue.close();

    const error = await queue.enqueue(job()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 503, code: 'QUEUE_UNAVAILABLE' });
  });

  it('cerrar cancela las esperas de reintento y no deja trabajos colgados', async () => {
    // La espera nunca se cumple sola: solo termina si close() la cancela
    const schedule = vi.fn(() => () => undefined);
    const queue = new MemoryNotificationQueue({ attempts: 5, backoffMs: 10, log: { error: vi.fn() }, schedule });
    const handler = vi.fn().mockRejectedValue(new Error('falla'));
    await queue.startConsumer(handler);
    await queue.enqueue(job());
    await vi.waitFor(() => expect(schedule).toHaveBeenCalledTimes(1));

    await queue.close();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(queue.failed()).toEqual([]);
  });

  it('la cola del proceso es única y se vuelve a crear después de cerrarla', async () => {
    const first = getNotificationQueue();
    expect(getNotificationQueue()).toBe(first);

    await closeNotificationQueue();

    expect(getNotificationQueue()).not.toBe(first);
    await closeNotificationQueue();
  });
});
