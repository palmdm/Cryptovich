import type { PrismaClient, Prisma } from "@platform/db";
import { Errors } from "../../lib/errors.js";

type Client = PrismaClient | Prisma.TransactionClient;

/** The extra facts a notification's buttons need — see `withContext`. */
export interface NotificationContext {
  creatorUsername: string | null;
  productTitle: string | null;
  paymentStatus: string | null;
}

type WelcomeKind = "NEW_SUBSCRIBER" | "RENEWAL" | "DONOR";


/**
 * The single place events turn into `Notification` rows — both the
 * creator-facing "someone subscribed/renewed/donated" kind and the
 * fan-facing welcome message. Every write method accepts an optional
 * transaction client so callers already inside a `$transaction` (payment
 * completion) commit the notification atomically with the rest of the
 * state change, the same pattern `EntitlementService` uses.
 */
export class NotificationService {
  constructor(private readonly prisma: PrismaClient) {}

  async notify(userId: string, type: string, payload: object | undefined, client: Client = this.prisma) {
    return client.notification.create({ data: { userId, type, payload } });
  }

  async notifyMany(userIds: string[], type: string, payload: object | undefined, client: Client = this.prisma) {
    if (userIds.length === 0) return;
    await client.notification.createMany({ data: userIds.map((userId) => ({ userId, type, payload })) });
  }

  /**
   * A welcome notification's data: the creator's own text for this event
   * if they have set one, and always the kind and their name — so with no
   * text of theirs the reader's page says "Спасибо за подписку на …" in
   * the reader's language (lib/notification-text.ts), never a sentence
   * made here in English. A fan always gets a welcome (spec: "welcome
   * messages for new subscribers, renewers, and donors are different").
   */
  welcomePayload(
    kind: WelcomeKind,
    creator: {
      displayName: string;
      welcomeMessageNewSubscriber: string | null;
      welcomeMessageRenewal: string | null;
      welcomeMessageDonor: string | null;
    },
  ): { kind: WelcomeKind; creatorName: string; message?: string } {
    const custom =
      kind === "NEW_SUBSCRIBER" ? creator.welcomeMessageNewSubscriber : kind === "RENEWAL" ? creator.welcomeMessageRenewal : creator.welcomeMessageDonor;
    return { kind, creatorName: creator.displayName, ...(custom ? { message: custom } : {}) };
  }

  async list(userId: string) {
    const [notifications, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { notifications: await this.withContext(notifications), unreadCount };
  }

  /**
   * How many are unread, and the kind and time of the newest few — a page
   * tells a new arrival by its time, and picks its sound by its kind.
   */
  async unread(userId: string) {
    const [unreadCount, latest] = await Promise.all([
      this.prisma.notification.count({ where: { userId, readAt: null } }),
      this.prisma.notification.findMany({ where: { userId, readAt: null }, orderBy: { createdAt: "desc" }, take: 10, select: { type: true, createdAt: true } }),
    ]);
    return { unreadCount, latest: latest.map((n) => ({ type: n.type, createdAt: n.createdAt.toISOString() })) };
  }

  /**
   * What a notification's buttons need that its own data does not say:
   * which author a post belongs to (for a link to it) and where a payment
   * stands (so "confirm" is not offered for one already settled). Looked up
   * for the whole page at once — two queries however many rows there are.
   *
   * The payment status is only read for the notification's own recipient,
   * whose row this is: the ids come from *their* notifications.
   */
  private async withContext<T extends { payload: unknown }>(
    notifications: T[],
  ): Promise<(T & { context: NotificationContext })[]> {
    const field = (n: { payload: unknown }, key: string): string | null => {
      const value = (n.payload as Record<string, unknown> | null)?.[key];
      return typeof value === "string" ? value : null;
    };
    const productIds = [...new Set(notifications.map((n) => field(n, "productId")).filter((v): v is string => v !== null))];
    const paymentIds = [...new Set(notifications.map((n) => field(n, "paymentId")).filter((v): v is string => v !== null))];

    const [products, payments] = await Promise.all([
      productIds.length
        ? this.prisma.digitalProduct.findMany({
            where: { id: { in: productIds } },
            select: { id: true, title: true, creator: { select: { user: { select: { username: true } } } } },
          })
        : [],
      paymentIds.length
        ? this.prisma.payment.findMany({ where: { id: { in: paymentIds } }, select: { id: true, status: true } })
        : [],
    ]);
    const productById = new Map(products.map((p) => [p.id, p]));
    const paymentById = new Map(payments.map((p) => [p.id, p.status]));

    return notifications.map((n) => {
      const product = productById.get(field(n, "productId") ?? "");
      const status = paymentById.get(field(n, "paymentId") ?? "");
      return {
        ...n,
        context: {
          creatorUsername: product?.creator.user.username ?? null,
          productTitle: product?.title ?? null,
          paymentStatus: status ?? null,
        },
      };
    });
  }

  async markRead(userId: string, id: string) {
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification || notification.userId !== userId) throw Errors.notFound("Notification");
    return this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  }
}
