import type { PrismaClient } from "@platform/db";
import { authorFederates, Money, type Currency } from "@platform/shared";
import { config } from "../../config.js";
import { SettingsService } from "../settings/service.js";
import { requireCreatorProfile } from "../products/product-helpers.js";

/**
 * A field as a spreadsheet will read it: quoted when it holds a comma, a
 * quote or a line break, and never as a formula. Tier and display names
 * are an author's own text, and one starting with `=`, `+`, `-` or `@`
 * would run as a formula in the reader's spreadsheet; a leading
 * apostrophe keeps it text.
 */
export function csvField(value: string | null | undefined): string {
  let text = value ?? "";
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: (string | null | undefined)[][]): string {
  return rows.map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n";
}

/** Without it, Excel opens UTF-8 as a legacy code page and Cyrillic is garbled. */
const BOM = "\uFEFF";

export const day = (date: Date) => date.toISOString().slice(0, 10);

function amount(amountMinor: bigint, currency: string): string {
  try {
    return Money.fromMinor(amountMinor, currency as Currency).toDecimalString();
  } catch {
    return amountMinor.toString();
  }
}

/** The ones /subscriptions lists: paid up, or behind but not yet lapsed. */
const CURRENT = { in: ["ACTIVE" as const, "PAST_DUE" as const] };

/**
 * Subscriptions as files: a reader's own list as a spreadsheet or as a
 * fediverse following list, and an author's subscribers as a spreadsheet.
 * Only what the matching page already shows the same person — no email,
 * no payment details.
 */
export class SubscriptionExportService {
  constructor(private readonly prisma: PrismaClient) {}

  async mine(userId: string): Promise<string> {
    const subscriptions = await this.prisma.subscription.findMany({
      where: { userId, status: CURRENT },
      include: { tier: { include: { creator: { select: { displayName: true, user: { select: { username: true } } } } } } },
      orderBy: { createdAt: "desc" },
    });
    const header = ["author", "author_name", "profile", "tier", "amount", "currency", "period", "status", "started_at", "expires_at", "cancelled_at"];
    return (
      BOM +
      toCsv([
        header,
        ...subscriptions.map(({ tier, ...s }) => [
          tier.creator.user.username,
          tier.creator.displayName,
          `${config.webOrigin}/${tier.creator.user.username}`,
          tier.name,
          amount(tier.amountMinor, tier.currency),
          tier.currency,
          tier.period.toLowerCase(),
          s.status.toLowerCase(),
          day(s.startedAt),
          day(s.expiresAt),
          s.cancelledAt ? day(s.cancelledAt) : "",
        ]),
      ])
    );
  }

  /**
   * The same authors as a following list in the format Mastodon exports
   * and imports (Preferences → Import and export), which Sharkey and
   * Misskey read too: following them there brings their free posts to
   * that account. Only authors this server federates are in it — any
   * other address is one nobody could follow.
   */
  async mineAsFollowing(userId: string): Promise<string> {
    const header = ["Account address", "Show boosts", "Notify on new posts", "Languages"];
    if (!(await new SettingsService(this.prisma).isFederationEnabled())) return toCsv([header]);
    const subscriptions = await this.prisma.subscription.findMany({
      where: { userId, status: CURRENT, tier: { creator: { user: { deletedAt: null, suspendedAt: null } } } },
      select: { tier: { select: { creator: { select: { federationSettings: { select: { enabled: true } }, user: { select: { username: true } } } } } } },
      orderBy: { createdAt: "desc" },
    });
    const host = new URL(config.federationBaseUrl).host;
    const authors = new Set<string>();
    for (const { tier } of subscriptions) {
      if (authorFederates(tier.creator.federationSettings)) authors.add(tier.creator.user.username);
    }
    return toCsv([header, ...[...authors].map((username) => [`${username}@${host}`, "true", "false", ""])]);
  }

  /** The author's subscribers — the same people /dashboard/subscribers lists. */
  async subscribers(userId: string): Promise<string> {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const subscriptions = await this.prisma.subscription.findMany({
      where: { tier: { creatorId: profile.id }, status: CURRENT },
      include: {
        user: { select: { username: true, creatorProfile: { select: { displayName: true } } } },
        tier: { select: { name: true, amountMinor: true, currency: true, period: true } },
      },
      orderBy: { startedAt: "desc" },
    });
    const header = ["subscriber", "name", "tier", "amount", "currency", "period", "status", "started_at", "expires_at", "cancelled_at"];
    return (
      BOM +
      toCsv([
        header,
        ...subscriptions.map((s) => [
          s.user.username,
          s.user.creatorProfile?.displayName ?? s.user.username,
          s.tier.name,
          amount(s.tier.amountMinor, s.tier.currency),
          s.tier.currency,
          s.tier.period.toLowerCase(),
          s.status.toLowerCase(),
          day(s.startedAt),
          day(s.expiresAt),
          s.cancelledAt ? day(s.cancelledAt) : "",
        ]),
      ])
    );
  }
}
