import type { EmailMessage, EmailProvider } from "./provider.js";

/**
 * What runs when no SMTP URL is configured: the message is logged and
 * discarded.
 *
 * `enabled` is false, and that is the point — every flow that depends on
 * mail checks it and refuses up front, so an operator who has not set
 * SMTP sees "password reset is unavailable on this server" rather than a
 * reset that silently never arrives. In development it also means the
 * link is right there in the API log.
 */
export class ConsoleEmailProvider implements EmailProvider {
  readonly enabled = false;

  async send(message: EmailMessage): Promise<void> {
    console.info(`[email:not-configured] to=${message.to} subject=${message.subject}\n${message.text}`);
  }
}
