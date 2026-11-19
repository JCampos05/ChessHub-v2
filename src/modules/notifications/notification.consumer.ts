import { env } from '../../config/env.js';
import { getMailSender } from '../../lib/mail.js';
import { logger } from '../../lib/logger.js';
import { getNotificationQueue } from '../../lib/queue.js';
import { processNotification } from './notification.worker.js';
import { notificationRepository } from './notification.repository.js';

// Conecta la cola con el procesamiento de notificaciones. El transporte de correo se crea al primer envío,
// así que con MAIL_ENABLED=false nunca se configura SMTP.
export async function startNotificationConsumer(): Promise<void> {
  await getNotificationQueue().startConsumer((job) =>
    processNotification(job, {
      repo: notificationRepository,
      mail: { send: (message) => getMailSender().send(message) },
      mailEnabled: env.MAIL_ENABLED,
    }),
  );
  logger.info({ mailEnabled: env.MAIL_ENABLED }, 'Consumidor de notificaciones iniciado');
}
