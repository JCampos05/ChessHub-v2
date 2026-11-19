import { TOURNAMENT_STATUSES, type TournamentState } from '../../domain/state-machines/tournament.js';
import type { MailSender } from '../../lib/mail.js';
import type { NotificationJob } from '../../lib/queue.js';
import { stateChangeDedupeKey, stateChangeMessage } from './notification.messages.js';
import type { NotificationWorkerRepository } from './notification.repository.js';

export interface ProcessDeps {
  repo: NotificationWorkerRepository;
  mail: MailSender;
  // El correo es adicional a la bandeja y solo sale con la bandera encendida
  mailEnabled: boolean;
}

const isTournamentState = (value: string): value is TournamentState =>
  (TOURNAMENT_STATUSES as readonly string[]).includes(value);

// Procesa un trabajo de la cola. Es idempotente: se puede ejecutar varias veces con el mismo cambio sin duplicar
// filas ni correos. Cualquier error lanzado significa «reintentar»; agotados los intentos la cola lo descarta.
export async function processNotification(job: NotificationJob, deps: ProcessDeps): Promise<void> {
  const { repo, mail, mailEnabled } = deps;

  // Redis y PostgreSQL no comparten transacción: el trabajo puede llegar antes de que el cambio sea visible
  // (o quedar huérfano si la transacción se revirtió); se reintenta hasta que aparezca o se agoten los intentos
  const change = await repo.findStateChange(job.changeId);
  if (!change) throw new Error(`El cambio de estado ${job.changeId} aún no existe`);
  const tournament = await repo.findTournament(change.entityId);
  if (!tournament) throw new Error(`El torneo ${change.entityId} del cambio ${job.changeId} no existe`);
  if (!isTournamentState(change.fromState) || !isTournamentState(change.toState)) {
    throw new Error(`El cambio ${job.changeId} tiene un estado desconocido`);
  }

  const content = stateChangeMessage({
    tournamentId: tournament.id,
    tournamentName: tournament.name,
    changeId: change.id,
    from: change.fromState,
    to: change.toState,
    reason: change.reason,
  });
  const dedupeKey = stateChangeDedupeKey(change.id);

  const recipients = await repo.findRecipients(tournament);
  await repo.createMany(
    recipients.map((recipient) => ({
      userId: recipient.id,
      type: content.type,
      title: content.title,
      body: content.body,
      data: content.data,
      dedupeKey,
    })),
  );

  if (!mailEnabled) return;

  // Solo las filas sin correo enviado: un reintento después de un fallo parcial no repite a quienes ya recibieron
  const pending = await repo.findUnsentEmails(dedupeKey);
  let failures = 0;
  for (const row of pending) {
    try {
      await mail.send({ to: row.email, subject: row.title, text: row.body });
      await repo.markEmailed(row.id);
    } catch {
      failures += 1;
    }
  }
  if (failures > 0) throw new Error(`No se pudo enviar el correo a ${failures} de ${pending.length} destinatarios`);
}
