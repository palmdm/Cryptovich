import type { PrismaClient } from "@platform/db";
import { ConsoleEmailProvider, SmtpEmailProvider, type EmailProvider } from "@platform/integrations";
import { SettingsService } from "../modules/settings/service.js";

let current: { settings: string; provider: EmailProvider } | null = null;

/**
 * The provider for the mail settings in force — `smtpUrl` and `emailFrom`,
 * which an administrator can change in the admin area (SMTP_URL and
 * EMAIL_FROM in .env until then) — built again only when they change.
 *
 * With no SMTP address this is the console provider, whose `enabled` is
 * false — every flow that needs mail checks that and refuses up front,
 * so an unconfigured server says "password reset is unavailable here"
 * instead of accepting a request whose mail will never arrive.
 */
export async function emailProvider(prisma: PrismaClient): Promise<EmailProvider> {
  const { smtpUrl, from } = await new SettingsService(prisma).email();
  const settings = `${smtpUrl}\n${from}`;
  if (current?.settings !== settings) {
    current = { settings, provider: smtpUrl ? new SmtpEmailProvider({ url: smtpUrl, from }) : new ConsoleEmailProvider() };
  }
  return current.provider;
}
