import { prisma } from "@platform/db";
import { storageFromEnv, type StorageBackend } from "@platform/integrations";
import { markdownToTelegramHtml, postPathFor } from "@platform/shared";
import { botWords, TelegramBot, TelegramError } from "../lib/telegram.js";
import { bridgeToken } from "./telegram-bridge.js";

const BATCH = 20;
const MAX_ATTEMPTS = 5;
/** Telegram's limit on a message's text, with room for the header and the link. */
const TEXT_LIMIT = 4096;
/** A bot may send files up to 50MB. */
const MAX_SEND = 50 * 1024 * 1024;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function readAll(storage: StorageBackend, key: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of storage.readStream(key)) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

/**
 * The post as one Telegram message: the author, the title, the text as the
 * reader may read it (or the lock), and the link to the post. A text too
 * long for one message is cut at a line and ends "read more".
 */
export function composeMessage(input: {
  author: string;
  title: string;
  full: boolean;
  text: string;
  url: string;
  languageCode: string | null;
}): string {
  const t = botWords(input.languageCode);
  const head = `<b>${escapeHtml(input.author)}</b>\n<b>${escapeHtml(input.title)}</b>\n\n`;
  const foot = (more: boolean) => `\n\n<a href="${escapeHtml(input.url)}">${more ? t("readMore") : t("openOnSite")}</a>`;
  if (!input.full) return `${head}${t("locked")}${foot(false)}`;
  let body = markdownToTelegramHtml(input.text);
  if (head.length + body.length + foot(false).length <= TEXT_LIMIT) return `${head}${body}${foot(false)}`;
  // Too long: fewer lines of the source until it fits (cutting the HTML
  // itself could leave a tag open).
  const lines = input.text.split("\n");
  while (lines.length > 1) {
    lines.pop();
    body = `${markdownToTelegramHtml(lines.join("\n"))}\n…`;
    if (head.length + body.length + foot(true).length <= TEXT_LIMIT) return `${head}${body}${foot(true)}`;
  }
  return `${head}${foot(true).trimStart()}`;
}

/**
 * Sends queued new posts to members' Telegram chats: the message, then —
 * for a reader who may read the post — its pictures (as an album) and
 * files. A member who blocked the bot stops receiving; Telegram asking to
 * slow down leaves the rest for the next round.
 */
export async function sendTelegramPosts(options: { bot?: TelegramBot; storage?: StorageBackend; webOrigin?: string } = {}): Promise<number> {
  const token = options.bot ? "given" : await bridgeToken();
  if (!token) return 0;
  const bot = options.bot ?? new TelegramBot(token);
  const storage = options.storage ?? storageFromEnv();
  const webOrigin = (options.webOrigin ?? process.env.WEB_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");

  const batch = await prisma.telegramDelivery.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: BATCH,
    include: {
      product: {
        select: {
          id: true,
          title: true,
          status: true,
          deletedAt: true,
          creator: { select: { displayName: true, user: { select: { username: true } } } },
          post: { select: { attachments: { orderBy: { position: "asc" } } } },
        },
      },
      user: { select: { telegramLink: true } },
    },
  });

  let sent = 0;
  for (const delivery of batch) {
    const link = delivery.user.telegramLink;
    const product = delivery.product;
    if (!link || !link.receivePosts || product.deletedAt || product.status !== "PUBLISHED") {
      await prisma.telegramDelivery.update({ where: { id: delivery.id }, data: { status: "FAILED", lastError: "Not linked, or the post is gone." } });
      continue;
    }
    const chat_id = link.chatId.toString();
    try {
      const url = `${webOrigin}${postPathFor(product.creator.user.username, product.id)}`;
      await bot.call("sendMessage", {
        chat_id,
        parse_mode: "HTML",
        text: composeMessage({ author: product.creator.displayName, title: product.title, full: delivery.full, text: delivery.text, url, languageCode: link.languageCode }),
        link_preview_options: { is_disabled: true },
      });
      if (delivery.full) {
        const attachments = product.post?.attachments ?? [];
        const images = attachments.filter((a) => a.kind === "IMAGE" && a.sizeBytes <= 10 * 1024 * 1024).slice(0, 10);
        if (images.length === 1) {
          const form = new FormData();
          form.append("chat_id", chat_id);
          form.append("photo", new Blob([await readAll(storage, images[0]!.storageKey)], { type: images[0]!.mimeType }), images[0]!.originalFilename);
          await bot.send("sendPhoto", form);
        } else if (images.length > 1) {
          const form = new FormData();
          form.append("chat_id", chat_id);
          form.append("media", JSON.stringify(images.map((_, n) => ({ type: "photo", media: `attach://p${n}` }))));
          for (const [n, image] of images.entries()) {
            form.append(`p${n}`, new Blob([await readAll(storage, image.storageKey)], { type: image.mimeType }), image.originalFilename);
          }
          await bot.send("sendMediaGroup", form);
        }
        for (const file of attachments.filter((a) => a.kind !== "IMAGE" && a.sizeBytes <= MAX_SEND)) {
          const form = new FormData();
          form.append("chat_id", chat_id);
          form.append("document", new Blob([await readAll(storage, file.storageKey)], { type: file.mimeType }), file.originalFilename);
          await bot.send("sendDocument", form);
        }
      }
      await prisma.telegramDelivery.update({ where: { id: delivery.id }, data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 } } });
      sent += 1;
    } catch (err) {
      const telegram = err instanceof TelegramError ? err : null;
      if (telegram?.code === 429) break; // asked to slow down: the rest wait for the next round
      const blocked = telegram?.code === 403;
      if (blocked) await prisma.telegramLink.update({ where: { id: link.id }, data: { receivePosts: false } });
      const attempts = delivery.attempts + 1;
      await prisma.telegramDelivery.update({
        where: { id: delivery.id },
        data: {
          attempts,
          lastError: (err instanceof Error ? err.message : String(err)).slice(0, 500),
          status: blocked || attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
        },
      });
    }
  }
  return sent;
}
