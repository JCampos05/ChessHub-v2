import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { queueUnavailable } from '../shared/errors.js';
import { logger } from './logger.js';
import type { FailedNotificationJob, NotificationHandler, NotificationJob, NotificationQueue } from './queue.js';

export const NOTIFICATION_QUEUE_NAME = 'notifications';

// Tiempo máximo para que Redis acepte un trabajo: pasado este plazo la petición recibe 503 en lugar de colgarse
const ENQUEUE_TIMEOUT_MS = 2_000;
const CLOSE_TIMEOUT_MS = 2_000;
const WARN_INTERVAL_MS = 30_000;

export interface BullQueueOptions {
  redisUrl: string;
  attempts: number;
  backoffMs: number;
  // Distinta de «notifications» solo en pruebas, para no mezclar trabajos de ejecuciones distintas
  queueName?: string;
}

// BullMQ recibe opciones de conexión (no instancias de ioredis) derivadas de REDIS_URL, para no mezclar versiones del cliente
export function redisConnectionOptions(redisUrl: string): { host: string; port: number } & Record<string, unknown> {
  const url = new URL(redisUrl);
  const db = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined;
  return {
    host: url.hostname,
    port: url.port === '' ? 6379 : Number(url.port),
    ...(url.username === '' ? {} : { username: decodeURIComponent(url.username) }),
    ...(url.password === '' ? {} : { password: decodeURIComponent(url.password) }),
    ...(db === undefined || Number.isNaN(db) ? {} : { db }),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

// Cola de producción: los trabajos viven en Redis y sobreviven a un reinicio del proceso
export class BullNotificationQueue implements NotificationQueue {
  private readonly queue: Queue<NotificationJob>;
  private readonly connection: ReturnType<typeof redisConnectionOptions>;
  private readonly name: string;
  private worker: Worker<NotificationJob> | null = null;
  private lastWarnAt = 0;

  constructor(private readonly options: BullQueueOptions) {
    this.name = options.queueName ?? NOTIFICATION_QUEUE_NAME;
    this.connection = redisConnectionOptions(options.redisUrl);
    // El productor falla rápido con Redis caído; el consumidor (Worker) exige reintentos ilimitados por orden
    this.queue = new Queue<NotificationJob>(this.name, {
      connection: {
        ...this.connection,
        enableOfflineQueue: false,
        connectTimeout: 1_000,
        retryStrategy: (attempt: number) => Math.min(attempt * 200, 2_000),
      } as ConnectionOptions,
    });
    this.queue.on('error', (error) => this.warn(error));
  }

  private warn(error: unknown): void {
    const now = Date.now();
    if (now - this.lastWarnAt < WARN_INTERVAL_MS) return;
    this.lastWarnAt = now;
    logger.warn({ err: error }, 'Redis no responde para la cola de notificaciones');
  }

  async enqueue(job: NotificationJob): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(queueUnavailable()), ENQUEUE_TIMEOUT_MS);
      timer.unref();
    });
    try {
      // El identificador del trabajo es el cambio: encolar dos veces el mismo cambio no lo duplica
      await Promise.race([
        this.queue.add('state-change', job, {
          jobId: job.changeId,
          attempts: this.options.attempts,
          backoff: { type: 'exponential', delay: this.options.backoffMs },
          removeOnComplete: { age: 3_600, count: 1_000 },
          removeOnFail: false,
        }),
        deadline,
      ]);
    } catch (error) {
      if (error instanceof Error && error.name === 'AppError') throw error;
      logger.error({ err: error, changeId: job.changeId }, 'Redis no aceptó el trabajo de notificación');
      throw queueUnavailable();
    } finally {
      clearTimeout(timer);
    }
  }

  async startConsumer(handler: NotificationHandler): Promise<void> {
    if (this.worker) throw new Error('La cola ya tiene un consumidor');
    const attempts = this.options.attempts;
    const worker = new Worker<NotificationJob>(this.name, async (job) => handler(job.data), {
      connection: { ...this.connection, maxRetriesPerRequest: null } as ConnectionOptions,
      concurrency: 5,
    });
    worker.on('error', (error) => this.warn(error));
    // Agotados los intentos el trabajo se conserva en la lista de fallidos y solo queda el registro
    worker.on('failed', (job, error) => {
      if (job && job.attemptsMade >= (job.opts.attempts ?? attempts)) {
        logger.error({ err: error, job: job.data, attempts: job.attemptsMade }, 'Notificación descartada tras agotar los intentos');
      }
    });
    this.worker = worker;
    await worker.waitUntilReady();
  }

  async failed(): Promise<FailedNotificationJob[]> {
    const jobs = await this.queue.getFailed();
    return jobs.map((job) => ({ job: job.data, attempts: job.attemptsMade, error: job.failedReason }));
  }

  // Solo para pruebas: deja la cola vacía
  async purge(): Promise<void> {
    await this.queue.obliterate({ force: true });
  }

  async close(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    const closing = Promise.all([worker?.close(), this.queue.close()]).then(() => undefined);
    // Con Redis caído el cierre ordenado puede no terminar: pasado el plazo se corta la conexión
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        void worker?.close(true);
        void this.queue.disconnect();
        resolve();
      }, CLOSE_TIMEOUT_MS);
      timer.unref();
    });
    try {
      await Promise.race([closing, timeout]);
    } catch (error) {
      logger.warn({ err: error }, 'No se pudo cerrar limpiamente la cola de notificaciones');
    } finally {
      clearTimeout(timer);
    }
  }
}
