import { createTransport } from 'nodemailer';
import { describe, expect, it, vi } from 'vitest';
import { createNodemailerSender, getMailSender } from '../../src/lib/mail.js';
import { stateChangeMessage } from '../../src/modules/notifications/notification.messages.js';

const FROM = 'ChessHub <no-reply@chesshub.local>';

describe('envío de correo (RF23)', () => {
  it('con el transporte JSON el mensaje sale con remitente, destinatario y texto de la notificación', async () => {
    const content = stateChangeMessage({
      tournamentId: 'torneo-1',
      tournamentName: 'Abierto de Primavera',
      changeId: 'cambio-1',
      from: 'REGISTRATION_OPEN',
      to: 'REGISTRATION_CLOSED',
    });
    const transport = createTransport({ jsonTransport: true });
    const sendMail = vi.spyOn(transport, 'sendMail');
    const sender = createNodemailerSender(transport, FROM);

    await sender.send({ to: 'arbitro@prueba.local', subject: content.title, text: content.body });

    expect(sendMail).toHaveBeenCalledTimes(1);
    const info = (await sendMail.mock.results[0]!.value) as { message: string };
    const sent = JSON.parse(info.message) as {
      from: { address: string; name: string };
      to: { address: string }[];
      subject: string;
      text: string;
    };
    expect(sent.from).toEqual({ name: 'ChessHub', address: 'no-reply@chesshub.local' });
    expect(sent.to.map((t) => t.address)).toEqual(['arbitro@prueba.local']);
    expect(sent.subject).toBe('Torneo «Abierto de Primavera»: de convocatoria a inscripciones cerradas');
    expect(sent.text).toBe('Se cerraron las inscripciones del torneo «Abierto de Primavera».');
  });

  it('un fallo del transporte se propaga para que el consumidor reintente', async () => {
    const transport = { sendMail: vi.fn().mockRejectedValue(new Error('conexión rechazada')) };
    const sender = createNodemailerSender(transport, FROM);

    await expect(sender.send({ to: 'a@prueba.local', subject: 's', text: 't' })).rejects.toThrow('conexión rechazada');
  });

  it('el remitente del proceso es único', () => {
    expect(getMailSender()).toBe(getMailSender());
  });
});
