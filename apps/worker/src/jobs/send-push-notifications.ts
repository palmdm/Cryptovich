import { prisma } from "@platform/db";
import { generateVapidKeys, WebPushSender, type PushResult, type PushTarget, type VapidKeys } from "@platform/integrations";
import { notificationPath, WEB_PUSH_VAPID_SETTING } from "@platform/shared";

const WEB_ORIGIN = (process.env.WEB_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
const BATCH = 100;
/** A notification older than this is not pushed: it is news no longer. */
const FRESH_FOR_MS = 60 * 60 * 1000;

/** The data a push carries — the service worker turns it into words in the reader's language. */
const CARRIED_FIELDS = ["title", "creatorName", "creatorUsername", "code", "message", "cancelled"] as const;

async function vapidKeys(env = process.env): Promise<VapidKeys> {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    return { publicKey: env.VAPID_PUBLIC_KEY.trim(), privateKey: env.VAPID_PRIVATE_KEY.trim() };
  }
  let row = await prisma.serverSetting.findUnique({ where: { key: WEB_PUSH_VAPID_SETTING } });
  if (!row) {
    await prisma.serverSetting.createMany({
      data: [{ key: WEB_PUSH_VAPID_SETTING, value: JSON.stringify(generateVapidKeys()) }],
      skipDuplicates: true,
    });
    row = await prisma.serverSetting.findUniqueOrThrow({ where: { key: WEB_PUSH_VAPID_SETTING } });
  }
  return JSON.parse(row.value) as VapidKeys;
}

/** Who runs this server, as VAPID asks: the site, or a mailto: when it is not https. */
function vapidSubject(): string {
  return WEB_ORIGIN.startsWith("https://") ? WEB_ORIGIN : "mailto:push@cryptovich.invalid";
}

export type PushSend = (target: PushTarget, payload: object) => Promise<PushResult>;

/**
 * Pushes new notifications to the browsers their readers subscribed.
 *
 * Only notifications that are fresh, not pushed yet, and whose reader has
 * at least one subscribed browser; each is marked pushed however the
 * sending went, so a failing browser never holds up the rest or gets the
 * same message twice. A subscription the push service says is gone is
 * deleted.
 */
export async function sendPushNotifications(options: { send?: PushSend } = {}): Promise<number> {
  const due = await prisma.notification.findMany({
    where: {
      pushedAt: null,
      createdAt: { gt: new Date(Date.now() - FRESH_FOR_MS) },
      user: { pushSubscriptions: { some: {} } },
    },
    orderBy: { createdAt: "asc" },
    take: BATCH,
    include: { user: { select: { pushSubscriptions: true } } },
  });
  if (due.length === 0) return 0;

  const send: PushSend = options.send ?? (() => {
    let sender: WebPushSender | null = null;
    return async (target, payload) => {
      sender ??= new WebPushSender(await vapidKeys(), vapidSubject());
      return sender.send(target, payload);
    };
  })();

  // Which author each mentioned post is by, for a link straight to it.
  const productIds = [
    ...new Set(
      due
        .map((n) => (n.payload as Record<string, unknown> | null)?.productId)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];
  const products = productIds.length
    ? await prisma.digitalProduct.findMany({
        where: { id: { in: productIds } },
        select: { id: true, creator: { select: { user: { select: { username: true } } } } },
      })
    : [];
  const authorOf = new Map(products.map((p) => [p.id, p.creator.user.username]));

  let pushed = 0;
  for (const notification of due) {
    const data = (notification.payload ?? {}) as Record<string, unknown>;
    const productId = typeof data.productId === "string" ? data.productId : null;
    const author = productId ? authorOf.get(productId) : undefined;
    const payload = {
      type: notification.type,
      data: Object.fromEntries(CARRIED_FIELDS.filter((field) => field in data).map((field) => [field, data[field]])),
      // The first place the notification's own page offers — the same
      // table, so a tap on the push and a tap on the row agree.
      url: notificationPath(notification.type, data, { creatorUsername: author }),
      tag: notification.id,
    };

    for (const subscription of notification.user.pushSubscriptions) {
      // In the language the reader subscribed from.
      const result = await send(subscription, { ...payload, locale: subscription.locale ?? undefined });
      if (result.ok) {
        await prisma.pushSubscription.update({ where: { id: subscription.id }, data: { lastSuccessAt: new Date() } });
      } else if (result.gone) {
        await prisma.pushSubscription.deleteMany({ where: { id: subscription.id } });
      } else {
        console.warn(`[push] ${notification.type} → ${new URL(subscription.endpoint).host}: ${result.status ?? ""} ${result.error}`);
      }
    }
    await prisma.notification.update({ where: { id: notification.id }, data: { pushedAt: new Date() } });
    pushed += 1;
  }
  return pushed;
}
