import { env } from '../config/env.js';
import { MemoryNotificationQueue } from './queue-memory.js';

// Trabajo de notificación: el cambio de estado ya está guardado; el consumidor resuelve destinatarios y envía
export interface NotificationJob {
  changeId: string;
  tournamentId: string;
}

// Un error lanzado por el manejador significa «reintentar»; agotados los intentos el trabajo pasa a fallidos
export type NotificationHandler = (job: NotificationJob) => Promise<void>;

export interface FailedNotificationJob {
  job: NotificationJob;
  attempts: number;
  error: string;
}

export interface NotificationQueue {
  // Falla con QUEUE_UNAVAILABLE (503) si la cola no acepta el trabajo
  enqueue(job: NotificationJob): Promise<void>;
  // Registra el consumidor; solo puede haber uno por proceso
  startConsumer(handler: NotificationHandler): Promise<void>;
  close(): Promise<void>;
}

let queue: NotificationQueue | undefined;

// Cola única del proceso. Sin REDIS_URL los trabajos viven en memoria (pruebas y desarrollo)
export function getNotificationQueue(): NotificationQueue {
  if (queue) return queue;
  queue = new MemoryNotificationQueue({ attempts: env.NOTIFICATION_ATTEMPTS, backoffMs: env.NOTIFICATION_BACKOFF_MS });
  return queue;
}

export async function closeNotificationQueue(): Promise<void> {
  if (!queue) return;
  const current = queue;
  queue = undefined;
  await current.close();
}
