import { queueUnavailable } from '../shared/errors.js';
import { logger } from './logger.js';
import type {
  FailedNotificationJob,
  NotificationHandler,
  NotificationJob,
  NotificationQueue,
} from './queue.js';

export interface QueueLog {
  error(context: object, message: string): void;
}

export interface MemoryQueueOptions {
  attempts: number;
  backoffMs: number;
  log?: QueueLog;
  // Programa una espera y devuelve cómo cancelarla; las pruebas la sustituyen para no esperar de verdad
  schedule?: (run: () => void, delayMs: number) => () => void;
}

const defaultSchedule: NonNullable<MemoryQueueOptions['schedule']> = (run, delayMs) => {
  const timer = setTimeout(run, delayMs);
  return () => clearTimeout(timer);
};

// Cola en memoria: misma semántica que la de Redis (intentos, espera creciente, fallidos) sin persistir nada
export class MemoryNotificationQueue implements NotificationQueue {
  private handler: NotificationHandler | null = null;
  private closed = false;
  private readonly waiting: NotificationJob[] = [];
  private readonly running = new Set<Promise<void>>();
  private readonly cancels = new Set<() => void>();
  private readonly failedJobs: FailedNotificationJob[] = [];
  private readonly log: QueueLog;
  private readonly schedule: NonNullable<MemoryQueueOptions['schedule']>;

  constructor(private readonly options: MemoryQueueOptions) {
    this.log = options.log ?? logger;
    this.schedule = options.schedule ?? defaultSchedule;
  }

  async enqueue(job: NotificationJob): Promise<void> {
    if (this.closed) throw queueUnavailable();
    if (this.handler) this.start(job, this.handler);
    else this.waiting.push(job);
  }

  async startConsumer(handler: NotificationHandler): Promise<void> {
    if (this.closed) throw queueUnavailable();
    if (this.handler) throw new Error('La cola ya tiene un consumidor');
    this.handler = handler;
    for (const job of this.waiting.splice(0)) this.start(job, handler);
  }

  // Espera a que terminen todos los trabajos en curso, reintentos incluidos (sin consumidor no hay nada que esperar)
  async drain(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running]);
  }

  failed(): FailedNotificationJob[] {
    return [...this.failedJobs];
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const cancel of [...this.cancels]) cancel();
    await this.drain();
  }

  private start(job: NotificationJob, handler: NotificationHandler): void {
    const lifecycle: Promise<void> = this.run(job, handler).finally(() => this.running.delete(lifecycle));
    this.running.add(lifecycle);
  }

  private async run(job: NotificationJob, handler: NotificationHandler): Promise<void> {
    // El trabajo arranca después de que el encolado devuelve el control a quien lo pidió
    await Promise.resolve();
    const { attempts, backoffMs } = this.options;

    for (let attempt = 1; attempt <= attempts && !this.closed; attempt += 1) {
      try {
        await handler(job);
        return;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (attempt === attempts) {
          this.failedJobs.push({ job, attempts: attempt, error: reason });
          this.log.error({ ...job, attempts: attempt, err: reason }, 'Notificación descartada: se agotaron los intentos');
          return;
        }
        // Espera creciente: backoff, 2×backoff, 4×backoff...
        await this.wait(backoffMs * 2 ** (attempt - 1));
        if (this.closed) return;
      }
    }
  }

  private wait(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      // Al cerrar se cancela la espera y el trabajo termina sin reintentar
      const abort = () => {
        cancelTimer();
        this.cancels.delete(abort);
        resolve();
      };
      const cancelTimer = this.schedule(() => {
        this.cancels.delete(abort);
        resolve();
      }, delayMs);
      this.cancels.add(abort);
    });
  }
}
