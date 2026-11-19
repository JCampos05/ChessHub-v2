import { createTransport, type Transporter } from 'nodemailer';
import { env } from '../config/env.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

// Un fallo de envío se propaga como error para que quien llama (el consumidor de la cola) reintente
export interface MailSender {
  send(message: MailMessage): Promise<void>;
}

// Adaptador de Nodemailer. Recibe el transporte para poder usar el de JSON (sin red) en las pruebas
export function createNodemailerSender(transport: Pick<Transporter, 'sendMail'>, from: string): MailSender {
  return {
    async send({ to, subject, text }) {
      await transport.sendMail({ from, to, subject, text });
    },
  };
}

let sender: MailSender | undefined;

// Remitente del proceso con el SMTP del entorno (Mailpit en desarrollo)
export function getMailSender(): MailSender {
  if (sender) return sender;
  const transport = createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    ...(env.SMTP_USER && env.SMTP_PASS ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } } : {}),
  });
  sender = createNodemailerSender(transport, env.MAIL_FROM);
  return sender;
}
