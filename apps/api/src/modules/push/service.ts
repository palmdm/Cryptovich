import type { PrismaClient } from "@platform/db";
import { generateVapidKeys, isAllowedPushEndpoint, type VapidKeys } from "@platform/integrations";
import { WEB_PUSH_VAPID_SETTING } from "@platform/shared";
import { z } from "zod";
import { Errors } from "../../lib/errors.js";

/**
 * This server's VAPID keypair — what browsers check a push against.
 * `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` in .env when the operator set
 * them, otherwise made on first use and kept (first write wins, so the API
 * and worker agree). Changing it unsubscribes every browser, so it is made
 * once and left alone.
 */
export async function vapidKeys(prisma: PrismaClient, env = process.env): Promise<VapidKeys> {
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

const base64url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/);

export const subscribeSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    // An uncompressed P-256 point and a 16-byte secret, base64url.
    p256dh: base64url.min(80).max(100),
    auth: base64url.min(16).max(32),
  }),
  locale: z.enum(["en", "ru", "ja"]).optional(),
});

export class PushService {
  constructor(private readonly prisma: PrismaClient) {}

  async publicKey(): Promise<string> {
    return (await vapidKeys(this.prisma)).publicKey;
  }

  /**
   * Remembers a browser for this account. An endpoint belongs to one
   * browser, so one that was another account's (the browser was shared,
   * someone signed out) moves to whoever subscribes it now.
   */
  async subscribe(userId: string, input: z.infer<typeof subscribeSchema>, userAgent: string | undefined) {
    if (!isAllowedPushEndpoint(input.endpoint)) {
      throw Errors.validation("That is not a browser push service.");
    }
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      update: {
        userId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: userAgent?.slice(0, 300) ?? null,
        locale: input.locale ?? null,
      },
      create: {
        userId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: userAgent?.slice(0, 300) ?? null,
        locale: input.locale ?? null,
      },
    });
  }

  async unsubscribe(userId: string, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  }
}
