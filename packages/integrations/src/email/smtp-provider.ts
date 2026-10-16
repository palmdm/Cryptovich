import { createTransport, type Transporter } from "nodemailer";
import type { EmailMessage, EmailProvider } from "./provider.js";
import { EmailProviderError } from "./provider.js";

export interface SmtpConfig {
  /** A full smtp:// or smtps:// URL, which is the whole configuration. */
  url: string;
  from: string;
}

/**
 * SMTP over nodemailer. A URL rather than a pile of host/port/user/pass
 * variables, because every provider documents one and it is the shape
 * least likely to be assembled wrongly.
 */
export class SmtpEmailProvider implements EmailProvider {
  readonly enabled = true;
  private readonly transport: Transporter;

  constructor(private readonly config: SmtpConfig) {
    this.transport = createTransport(config.url);
  }

  async send(message: EmailMessage): Promise<void> {
    try {
      await this.transport.sendMail({
        from: this.config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    } catch (error) {
      // The caller must not leak whether a specific address bounced —
      // it wraps this and answers the same either way.
      throw new EmailProviderError(error instanceof Error ? error.message : "Could not send that email.");
    }
  }
}
