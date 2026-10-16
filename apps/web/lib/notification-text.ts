import type { TranslationKey } from "./i18n/en";

/**
 * How each kind of notification reads: a translated phrase, and sometimes
 * a name or title from its data after it. One table for the notifications
 * page and for browser pushes (the service worker is generated from it —
 * see app/sw.js/route.ts), so the two never word the same event differently.
 */
export interface NotificationTextRule {
  key: TranslationKey;
  /** Used instead of `key` when the data says `cancelled`. */
  cancelledKey?: TranslationKey;
  /** A field of the data appended after the phrase… */
  field?: string;
  /** …or, when it is missing, this phrase instead and nothing appended. */
  missingKey?: TranslationKey;
  /** …or this one when that is missing. */
  fallbackField?: string;
  /** What joins them. */
  joiner?: string;
  /** A code appended after an em dash. */
  codeField?: string;
  /** The author's own words, shown as they are when present. */
  ownField?: string;
  /**
   * A phrase chosen by this field of the data — "NEW_SUBSCRIBER" → "Спасибо
   * за подписку на {name}!" — with `{name}` from `nameField`. Composed
   * here, in the reader's language; a server-made sentence was English.
   */
  byField?: string;
  phrases?: Record<string, TranslationKey>;
  nameField?: string;
}

export const NOTIFICATION_TEXT: Record<string, NotificationTextRule> = {
  WELCOME_MESSAGE: {
    key: "notify.welcome",
    ownField: "message",
    byField: "kind",
    phrases: { NEW_SUBSCRIBER: "notify.welcome.NEW_SUBSCRIBER", RENEWAL: "notify.welcome.RENEWAL", DONOR: "notify.welcome.DONOR" },
    nameField: "creatorName",
  },
  NEW_SUBSCRIBER: { key: "notify.newSubscriber" },
  SUBSCRIPTION_RENEWED: { key: "notify.renewed" },
  DONATION_RECEIVED: { key: "notify.donation" },
  PAYMENT_MARKED_PAID: { key: "notify.markedPaid" },
  PRODUCT_PURCHASED: { key: "notify.purchased" },
  NEW_COMMENT: { key: "notify.newComment" },
  NEW_POST: { key: "notify.newPost", field: "title", joiner: ": " },
  SUBSCRIPTION_EXPIRING: { key: "notify.expiring", field: "creatorName", fallbackField: "creatorUsername", joiner: " " },
  SUBSCRIPTION_EXPIRED: {
    key: "notify.expired",
    cancelledKey: "notify.expiredCancelled",
    field: "creatorName",
    fallbackField: "creatorUsername",
    joiner: " ",
  },
  DISCOUNT_AVAILABLE: { key: "notify.discount", field: "creatorName", joiner: " ", codeField: "code" },
  API_ACCESS_APPROVED: { key: "notify.apiApproved" },
  REPORT_FILED: { key: "notify.reportFiled" },
  ANNOUNCEMENT: { key: "notify.announcement", field: "excerpt", joiner: ": " },
  API_ACCESS_REJECTED: { key: "notify.apiRejected" },
  API_ACCESS_REVOKED: { key: "notify.apiRevoked" },
  // Who sent it, unless they asked to stay anonymous.
  REWARD_RECEIVED: { key: "notify.rewardFrom", field: "senderUsername", joiner: " @", missingKey: "notify.reward" },
  AUTHOR_BIRTHDAY: { key: "notify.birthday", field: "creatorName", fallbackField: "creatorUsername", joiner: " " },
};

export function notificationText(
  type: string,
  data: Record<string, unknown> | null | undefined,
  t: (key: TranslationKey) => string,
): string {
  const rule = NOTIFICATION_TEXT[type];
  if (!rule) return type;
  const d = data ?? {};
  // The creator wrote this one themselves — shown as-is, untranslated.
  if (rule.ownField && typeof d[rule.ownField] === "string" && d[rule.ownField]) return String(d[rule.ownField]);
  const phrase = rule.byField && rule.phrases ? rule.phrases[String(d[rule.byField])] : undefined;
  if (phrase) return t(phrase).replace("{name}", String((rule.nameField && d[rule.nameField]) || d.creatorUsername || ""));
  const value = rule.field ? (d[rule.field] ?? (rule.fallbackField ? d[rule.fallbackField] : undefined)) : undefined;
  const missing = value === undefined || value === null || value === "";
  if (rule.missingKey && missing) return t(rule.missingKey);
  let text = t(rule.cancelledKey && d.cancelled ? rule.cancelledKey : rule.key);
  if (rule.field) text += `${rule.joiner ?? " "}${missing ? "" : String(value)}`;
  if (rule.codeField) text += ` — ${String(d[rule.codeField] ?? "")}`;
  return text;
}
