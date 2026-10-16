export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text only — this platform sends no marketing and needs no HTML. */
  text: string;
}

/**
 * Sending mail is behind an interface for the same reason payments and
 * federation are: business logic never imports a vendor SDK, and an
 * operator who has not configured SMTP still gets a server that runs.
 */
export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
  /**
   * Whether mail can actually leave this server. Callers use it to
   * decide whether to *offer* a flow (password reset) at all, rather
   * than letting someone request a mail that will never arrive.
   */
  readonly enabled: boolean;
}

export class EmailProviderError extends Error {}
