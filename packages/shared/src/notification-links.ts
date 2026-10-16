import { postPathFor } from "./post-links.js";

/**
 * Where a notification can take the reader, one entry per place.
 *
 * A notification is rarely about one destination: a tip is something to
 * confirm in Payments *and* something that moved the Analytics figures, a
 * new subscriber is in Subscribers and in the numbers too. So each kind
 * lists every place that makes sense, in the order they matter — the first
 * is what tapping the notification itself (or its browser push) opens.
 *
 * Pure data with no wording, because the web page, the service worker's
 * click target and the worker's push URL all read it: the page adds the
 * labels and icons, the worker only needs the first path.
 *
 * An id with no `href` is something done on the spot (confirming a
 * payment, copying a code) rather than somewhere to go.
 */
export type NotificationActionId =
  | "confirm-payment"
  | "reject-payment"
  | "payments"
  | "analytics"
  | "subscribers"
  | "tiers"
  | "open-post"
  | "open-comments"
  | "author"
  | "membership"
  | "library"
  | "subscriptions"
  | "api-access"
  | "tokens"
  | "rewards"
  | "reports"
  | "announcement"
  | "copy-code";

export interface NotificationActionSpec {
  id: NotificationActionId;
  href?: string;
}

/** What the notification's own data cannot say: names looked up by id. */
export interface NotificationContext {
  /** The author the notification is about (the owner of the post). */
  creatorUsername?: string | null;
  /** Where a payment stands — "confirm" is only offered while it is open. */
  paymentStatus?: string | null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/** Everything a notification of this kind can do, most useful first. */
export function notificationActionsFor(
  type: string,
  data: Record<string, unknown> | null | undefined,
  context: NotificationContext = {},
): NotificationActionSpec[] {
  const d = data ?? {};
  const author = context.creatorUsername ?? text(d.creatorUsername);
  const productId = text(d.productId);
  const post = author && productId ? postPathFor(author, productId) : null;
  const authorPage = author ? `/${author}` : null;

  const actions: NotificationActionSpec[] = [];
  const add = (id: NotificationActionId, href?: string | null) => {
    if (href === null) return;
    actions.push(href === undefined ? { id } : { id, href });
  };

  switch (type) {
    case "PAYMENT_MARKED_PAID":
      // The payer says they have paid: settle it here, or look at it first.
      // Once it is settled (or refused) there is nothing left to confirm.
      if (!context.paymentStatus || context.paymentStatus === "AWAITING_PAYMENT") {
        add("confirm-payment");
        add("reject-payment");
      }
      add("payments", "/dashboard/payments");
      add("analytics", "/dashboard/analytics");
      break;
    case "DONATION_RECEIVED":
      add("payments", "/dashboard/payments");
      add("analytics", "/dashboard/analytics");
      break;
    case "REWARD_RECEIVED":
      add("rewards", "/dashboard/rewards");
      break;
    case "AUTHOR_BIRTHDAY":
      add("author", authorPage);
      break;
    case "NEW_SUBSCRIBER":
    case "SUBSCRIPTION_RENEWED":
      add("subscribers", "/dashboard/subscribers");
      add("analytics", "/dashboard/analytics");
      add("tiers", "/dashboard/tiers");
      break;
    case "NEW_COMMENT":
      add("open-comments", post ? `${post}#${text(d.commentId) ? `comment-${text(d.commentId)}` : "comments"}` : null);
      add("analytics", "/dashboard/analytics");
      break;
    case "NEW_POST":
      add("open-post", post);
      add("author", authorPage);
      break;
    case "PRODUCT_PURCHASED":
      add("library", "/library");
      add("open-post", post);
      break;
    case "WELCOME_MESSAGE":
      add("author", authorPage);
      add("subscriptions", "/subscriptions");
      break;
    case "SUBSCRIPTION_EXPIRING":
    case "SUBSCRIPTION_EXPIRED":
      // Renewing is a membership on the author's page.
      add("membership", authorPage);
      add("subscriptions", "/subscriptions");
      break;
    case "DISCOUNT_AVAILABLE":
      add("membership", authorPage);
      add("copy-code");
      break;
    case "API_ACCESS_APPROVED":
      add("tokens", "/dashboard/tokens");
      add("api-access", "/dashboard/api-access");
      break;
    case "REPORT_FILED":
      add("reports", "/admin?tab=reports");
      break;
    case "ANNOUNCEMENT":
      add("announcement", text(d.announcementId) ? `/?announcement=${encodeURIComponent(text(d.announcementId)!)}` : "/");
      break;
    case "API_ACCESS_REJECTED":
    case "API_ACCESS_REVOKED":
      add("api-access", "/dashboard/api-access");
      break;
    default:
      break;
  }
  return actions;
}

/** The one path a notification (or its push) opens on a plain tap. */
export function notificationPath(
  type: string,
  data: Record<string, unknown> | null | undefined,
  context: NotificationContext = {},
): string {
  return notificationActionsFor(type, data, context).find((a) => a.href)?.href ?? "/notifications";
}
