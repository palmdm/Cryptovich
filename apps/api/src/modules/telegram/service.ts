import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@platform/db";
import type { Redis } from "ioredis";
import { safeFetch } from "@platform/integrations";
import { Errors } from "../../lib/errors.js";
import { storageService } from "../../lib/storage.js";
import { SettingsService } from "../settings/service.js";
import { EntitlementService } from "../entitlements/service.js";
import { ShortLinkService } from "../short-links/service.js";

const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newCode(): string {
  return [...randomBytes(10)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

async function readAll(key: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of storageService.readStream(key)) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

/**
 * The server's Telegram bot as a bridge (Admin → parameters: the bot's
 * token and "Telegram bridge"). A member links their Telegram by sending
 * the bot a one-time code; then new posts of authors they follow or
 * subscribe to reach their chat — whole if they may read them, otherwise
 * the title and a link — and an author may publish by writing to the bot.
 * The worker talks to Telegram; this decides what may be sent and makes
 * the posts, through the same services the site uses.
 */
export class TelegramService {
  private readonly settings: SettingsService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis?: Redis,
  ) {
    this.settings = new SettingsService(prisma);
  }

  /** The bot's @name, for the link that opens it (asked of Telegram once a day). */
  async botUsername(): Promise<string | null> {
    const cached = await this.redis?.get("telegram:bot-username");
    if (cached) return cached;
    const token = await this.settings.telegramBotToken();
    if (!token) return null;
    try {
      const res = await safeFetch(`https://api.telegram.org/bot${token}/getMe`, { timeoutMs: 8000 });
      const body = (await res.json()) as { ok: boolean; result?: { username?: string } };
      const name = body.ok ? (body.result?.username ?? null) : null;
      if (name) await this.redis?.set("telegram:bot-username", name, "EX", 24 * 60 * 60);
      return name;
    } catch {
      return null;
    }
  }

  async status(userId: string) {
    const [bridge, link] = await Promise.all([this.settings.telegramBridge(), this.prisma.telegramLink.findUnique({ where: { userId } })]);
    return {
      bridge,
      botUsername: bridge ? await this.botUsername() : null,
      link: link
        ? {
            telegramUsername: link.telegramUsername,
            receivePosts: link.receivePosts,
            publishEnabled: link.publishEnabled,
            publishVisibility: link.publishVisibility,
            publishAsDraft: link.publishAsDraft,
            linkedAt: link.linkedAt,
          }
        : null,
    };
  }

  /** A one-time code for /start, and the link that opens the bot with it. */
  async linkCode(userId: string) {
    if (!(await this.settings.telegramBridge())) throw Errors.validation("The Telegram bridge is switched off on this server.");
    const bot = await this.botUsername();
    if (!bot) throw Errors.validation("The server's Telegram bot does not answer; ask the administrator.");
    await this.prisma.telegramLinkCode.deleteMany({ where: { OR: [{ userId }, { expiresAt: { lt: new Date() } }] } });
    const code = newCode();
    await this.prisma.telegramLinkCode.create({ data: { code, userId, expiresAt: new Date(Date.now() + CODE_TTL_MS) } });
    return { code, url: `https://t.me/${bot}?start=${code}`, expiresInSeconds: CODE_TTL_MS / 1000 };
  }

  async update(userId: string, input: { receivePosts?: boolean; publishEnabled?: boolean; publishVisibility?: string; publishAsDraft?: boolean }) {
    const link = await this.prisma.telegramLink.findUnique({ where: { userId } });
    if (!link) throw Errors.notFound("Telegram link");
    await this.prisma.telegramLink.update({ where: { userId }, data: input });
    return this.status(userId);
  }

  async unlink(userId: string) {
    await this.prisma.telegramLink.deleteMany({ where: { userId } });
  }

  /**
   * Queues a new post for the linked members who hear of it: each gets the
   * post as they may read it — the whole text (personal links made) when
   * they have access, else nothing but the title and a link.
   */
  async enqueue(productId: string, authorUserId: string, audience: string[]): Promise<number> {
    if (audience.length === 0 || !(await this.settings.telegramBridge())) return 0;
    const links = await this.prisma.telegramLink.findMany({ where: { userId: { in: audience }, receivePosts: true }, select: { userId: true } });
    if (links.length === 0) return 0;
    const post = await this.prisma.post.findUnique({ where: { productId }, select: { content: true } });
    const entitlements = new EntitlementService(this.prisma);
    const shortLinks = new ShortLinkService(this.prisma);
    const rows = await Promise.all(
      links.map(async ({ userId }) => {
        const full = (await entitlements.canAccessProduct(userId, productId)).allowed;
        const text = full ? ((await shortLinks.personalize([{ productId, ownerId: authorUserId, text: post?.content ?? "" }], userId))[0] ?? "") : "";
        return { productId, userId, full, text };
      }),
    );
    const { count } = await this.prisma.telegramDelivery.createMany({ data: rows, skipDuplicates: true });
    return count;
  }

  /**
   * A post written to the bot, handed over by the worker: made and
   * published as the linked author through the site's own services, its
   * files (already stored by the worker) attached the way an upload is.
   */
  async publishFromChat(
    input: { chatId: string; title: string; content: string; files: { storageKey: string; mimeType: string; filename: string }[] },
    services: {
      createPost: (userId: string, data: { title: string; content: string; visibility: "PUBLIC" | "SUBSCRIBERS" }) => Promise<{ id: string }>;
      attach: (userId: string, productId: string, file: { buffer: Buffer; mimeType: string; filename: string }) => Promise<unknown>;
      publish: (userId: string, productId: string) => Promise<unknown>;
    },
  ) {
    const link = await this.prisma.telegramLink.findUnique({ where: { chatId: BigInt(input.chatId) }, include: { user: { select: { username: true } } } });
    if (!link || !link.publishEnabled) throw Errors.forbidden();
    const visibility = link.publishVisibility === "SUBSCRIBERS" ? "SUBSCRIBERS" : "PUBLIC";
    try {
      const product = await services.createPost(link.userId, { title: input.title, content: input.content, visibility });
      for (const file of input.files) {
        await services.attach(link.userId, product.id, { buffer: await readAll(file.storageKey), mimeType: file.mimeType, filename: file.filename });
      }
      if (!link.publishAsDraft) await services.publish(link.userId, product.id);
      return { productId: product.id, username: link.user.username, draft: link.publishAsDraft };
    } finally {
      // The worker's copies were only a way across.
      for (const file of input.files) await storageService.delete(file.storageKey).catch(() => undefined);
    }
  }
}
