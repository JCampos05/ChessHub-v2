export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

// Un fallo de envío se propaga como error para que quien llama (el consumidor de la cola) reintente
export interface MailSender {
  send(message: MailMessage): Promise<void>;
}
