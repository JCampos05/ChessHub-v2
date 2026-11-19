import { describe, expect, it, vi } from 'vitest';
import type { MailMessage } from '../../src/lib/mail.js';
import type {
  NewNotification,
  NotificationWorkerRepository,
  Recipient,
  StateChangeRecord,
  TournamentRecord,
} from '../../src/modules/notifications/notification.repository.js';
import { processNotification } from '../../src/modules/notifications/notification.worker.js';

const TOURNAMENT: TournamentRecord = { id: 'torneo-1', name: 'Abierto de Primavera', createdById: 'u-creador' };
const CHANGE: StateChangeRecord = {
  id: 'cambio-1',
  entityId: TOURNAMENT.id,
  fromState: 'REGISTRATION_OPEN',
  toState: 'REGISTRATION_CLOSED',
  reason: null,
};
const RECIPIENTS: Recipient[] = [
  { id: 'u-creador', email: 'creador@prueba.local' },
  { id: 'u-arbitro', email: 'arbitro@prueba.local' },
  { id: 'u-organizador', email: 'organizador@prueba.local' },
];
const JOB = { changeId: CHANGE.id, tournamentId: TOURNAMENT.id };

interface StoredRow extends NewNotification {
  id: string;
  emailedAt: Date | null;
  email: string;
}

// Repositorio en memoria con las mismas garantías que la base: único (usuario, clave) y correo pendiente por fila
function makeRepo(options: { change?: StateChangeRecord | null; tournament?: TournamentRecord | null } = {}) {
  const rows: StoredRow[] = [];
  const emailOf = new Map(RECIPIENTS.map((r) => [r.id, r.email]));
  const repo: NotificationWorkerRepository = {
    findStateChange: async () => (options.change === undefined ? CHANGE : options.change),
    findTournament: async () => (options.tournament === undefined ? TOURNAMENT : options.tournament),
    findRecipients: async () => RECIPIENTS,
    createMany: async (incoming) => {
      for (const row of incoming) {
        if (rows.some((r) => r.userId === row.userId && r.dedupeKey === row.dedupeKey)) continue;
        rows.push({ ...row, id: `n-${rows.length + 1}`, emailedAt: null, email: emailOf.get(row.userId) ?? '' });
      }
    },
    findUnsentEmails: async (dedupeKey) =>
      rows
        .filter((r) => r.dedupeKey === dedupeKey && r.emailedAt === null)
        .map((r) => ({ id: r.id, email: r.email, title: r.title, body: r.body })),
    markEmailed: async (id) => {
      const row = rows.find((r) => r.id === id);
      if (row) row.emailedAt = new Date();
    },
  };
  return { repo, rows };
}

function makeMail(failFor: string[] = []) {
  const sent: MailMessage[] = [];
  const failing = new Set(failFor);
  const mail = {
    send: vi.fn(async (message: MailMessage) => {
      if (failing.has(message.to)) throw new Error('SMTP caído');
      sent.push(message);
    }),
  };
  return { mail, sent, failing };
}

describe('procesar notificación de cambio de estado (RF22, RF23)', () => {
  it('crea una fila por destinatario con el texto del cambio', async () => {
    const { repo, rows } = makeRepo();
    const { mail } = makeMail();

    await processNotification(JOB, { repo, mail, mailEnabled: false });

    expect(rows.map((r) => r.userId)).toEqual(['u-creador', 'u-arbitro', 'u-organizador']);
    expect(rows[0]).toMatchObject({
      type: 'TOURNAMENT_STATE_CHANGED',
      title: 'Torneo «Abierto de Primavera»: de convocatoria a inscripciones cerradas',
      dedupeKey: 'state_change:cambio-1',
    });
    expect(rows[0]?.data).toMatchObject({ tournamentId: 'torneo-1', changeId: 'cambio-1', to: 'REGISTRATION_CLOSED' });
  });

  it('incluye el motivo del cambio en el cuerpo', async () => {
    const { repo, rows } = makeRepo({
      change: { ...CHANGE, toState: 'CANCELLED', fromState: 'IN_PROGRESS', reason: 'Sede no disponible' },
    });

    await processNotification(JOB, { repo, mail: makeMail().mail, mailEnabled: false });

    expect(rows[0]?.body).toContain('Motivo: Sede no disponible');
  });

  it('reintentar el mismo trabajo no duplica filas', async () => {
    const { repo, rows } = makeRepo();
    const deps = { repo, mail: makeMail().mail, mailEnabled: false };

    await processNotification(JOB, deps);
    await processNotification(JOB, deps);
    await processNotification(JOB, deps);

    expect(rows).toHaveLength(3);
  });

  it('lanza un error reintentable si el cambio aún no existe y no crea nada', async () => {
    const { repo, rows } = makeRepo({ change: null });
    const { mail } = makeMail();

    await expect(processNotification(JOB, { repo, mail, mailEnabled: true })).rejects.toThrow(/aún no existe/);

    expect(rows).toEqual([]);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('lanza un error si el torneo del cambio no existe', async () => {
    const { repo, rows } = makeRepo({ tournament: null });

    await expect(processNotification(JOB, { repo, mail: makeMail().mail, mailEnabled: false })).rejects.toThrow(
      /no existe/,
    );
    expect(rows).toEqual([]);
  });

  it('lanza un error si el cambio guarda un estado desconocido', async () => {
    const { repo } = makeRepo({ change: { ...CHANGE, toState: 'CONFIRMADO' } });

    await expect(processNotification(JOB, { repo, mail: makeMail().mail, mailEnabled: false })).rejects.toThrow(
      /estado desconocido/,
    );
  });

  it('sin destinatarios no crea filas ni falla', async () => {
    const { repo, rows } = makeRepo();
    repo.findRecipients = async () => [];

    await expect(processNotification(JOB, { repo, mail: makeMail().mail, mailEnabled: true })).resolves.toBeUndefined();
    expect(rows).toEqual([]);
  });

  describe('correo', () => {
    it('con MAIL_ENABLED apagado no envía nada y deja las filas sin marcar', async () => {
      const { repo, rows } = makeRepo();
      const { mail } = makeMail();

      await processNotification(JOB, { repo, mail, mailEnabled: false });

      expect(mail.send).not.toHaveBeenCalled();
      expect(rows.every((r) => r.emailedAt === null)).toBe(true);
    });

    it('encendido, envía un correo por destinatario con título y cuerpo, y marca las filas', async () => {
      const { repo, rows } = makeRepo();
      const { mail, sent } = makeMail();

      await processNotification(JOB, { repo, mail, mailEnabled: true });

      expect(sent.map((m) => m.to)).toEqual(RECIPIENTS.map((r) => r.email));
      expect(sent[0]).toMatchObject({
        subject: 'Torneo «Abierto de Primavera»: de convocatoria a inscripciones cerradas',
        text: 'Se cerraron las inscripciones del torneo «Abierto de Primavera».',
      });
      expect(rows.every((r) => r.emailedAt !== null)).toBe(true);
    });

    it('un reintento después de enviar todo no manda correos repetidos', async () => {
      const { repo } = makeRepo();
      const { mail } = makeMail();
      const deps = { repo, mail, mailEnabled: true };

      await processNotification(JOB, deps);
      await processNotification(JOB, deps);

      expect(mail.send).toHaveBeenCalledTimes(3);
    });

    it('un fallo parcial lanza el error y el reintento envía solo a los pendientes', async () => {
      const { repo, rows } = makeRepo();
      const { mail, sent, failing } = makeMail(['arbitro@prueba.local']);
      const deps = { repo, mail, mailEnabled: true };

      await expect(processNotification(JOB, deps)).rejects.toThrow(/1 de 3/);
      expect(sent.map((m) => m.to)).toEqual(['creador@prueba.local', 'organizador@prueba.local']);
      expect(rows.filter((r) => r.emailedAt === null).map((r) => r.userId)).toEqual(['u-arbitro']);

      failing.clear();
      await processNotification(JOB, deps);

      expect(sent.map((m) => m.to)).toEqual([
        'creador@prueba.local',
        'organizador@prueba.local',
        'arbitro@prueba.local',
      ]);
      expect(rows.every((r) => r.emailedAt !== null)).toBe(true);
      expect(rows).toHaveLength(3);
    });

    it('el correo no lleva datos de contacto de jugadores', async () => {
      const { repo } = makeRepo();
      const { mail, sent } = makeMail();

      await processNotification(JOB, { repo, mail, mailEnabled: true });

      for (const message of sent) {
        expect(`${message.subject} ${message.text}`).not.toMatch(/@|\d{7,}/);
      }
    });
  });
});
