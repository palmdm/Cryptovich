import { prisma } from "@platform/db";
import { storageFromEnv, type StorageBackend } from "@platform/integrations";
import { hasOwnText, postPathFor, telegramToMarkdown, type TelegramEntity } from "@platform/shared";
import { botWords, TelegramBot } from "../lib/telegram.js";
import { parameter } from "../lib/parameters.js";
import { apiInternalUrl, internalToken } from "../lib/internal-token.js";

interface TgFile {
  file_id: string;
  file_size?: number;
}
export interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; username?: string; language_code?: string };
  text?: string;
  entities?: TelegramEntity[];
  caption?: string;
  caption_entities?: TelegramEntity[];
  photo?: (TgFile & { width: number; height: number })[];
  document?: TgFile & { file_name?: string; mime_type?: string };
  video?: TgFile & { file_name?: string; mime_type?: string };
  audio?: TgFile & { file_name?: string; mime_type?: string };
  media_group_id?: string;
}
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

const OFFSET_KEY = "telegramUpdateOffset";
/** An album arrives as one message per picture; it is a post once no part has come for this long. */
const ALBUM_SETTLE_MS = 2500;
const albums = new Map<string, { messages: TgMessage[]; lastAt: number }>();

export interface BridgeDeps {
  bot: TelegramBot;
  storage: StorageBackend;
  /** Hands a post to the API; the worker never makes posts itself. */
  publish: (body: unknown) => Promise<{ ok: true; productId: string; username: string; draft: boolean } | { ok: false; message: string }>;
  webOrigin: string;
}

/** The bot's token when the bridge is on, else null. */
export async function bridgeToken(): Promise<string | null> {
  const [on, token] = await Promise.all([parameter("telegramBridge"), parameter("telegramBotToken")]);
  return on === "true" && token ? token : null;
}

function defaultDeps(token: string): BridgeDeps {
  return {
    bot: new TelegramBot(token),
    storage: storageFromEnv(),
    webOrigin: (process.env.WEB_ORIGIN ?? "http://localhost:3000").replace(/\/$/, ""),
    publish: async (body) => {
      const res = await fetch(`${apiInternalUrl()}/internal/telegram/posts`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-token": await internalToken() },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
      const json = (await res.json().catch(() => ({}))) as { productId?: string; username?: string; draft?: boolean; error?: { message?: string } };
      return res.ok && json.productId
        ? { ok: true, productId: json.productId, username: json.username ?? "", draft: Boolean(json.draft) }
        : { ok: false, message: json.error?.message ?? `HTTP ${res.status}` };
    },
  };
}

async function say(deps: BridgeDeps, chatId: number, text: string) {
  await deps.bot.call("sendMessage", { chat_id: chatId, text, link_preview_options: { is_disabled: true } });
}

/** /start <code>: the member who asked for the code on the site, linked to this chat. */
async function link(deps: BridgeDeps, message: TgMessage, code: string) {
  const t = botWords(message.from?.language_code);
  const row = await prisma.telegramLinkCode.findUnique({ where: { code: code.toUpperCase() }, include: { user: { select: { username: true } } } });
  if (!row || row.expiresAt < new Date()) return say(deps, message.chat.id, t("badCode"));
  const chatId = BigInt(message.chat.id);
  await prisma.$transaction([
    // A chat belongs to one account: linking it here unlinks it elsewhere.
    prisma.telegramLink.deleteMany({ where: { chatId, NOT: { userId: row.userId } } }),
    prisma.telegramLink.upsert({
      where: { userId: row.userId },
      create: { userId: row.userId, chatId, telegramUsername: message.from?.username ?? null, languageCode: message.from?.language_code ?? null },
      update: { chatId, telegramUsername: message.from?.username ?? null, languageCode: message.from?.language_code ?? null },
    }),
    prisma.telegramLinkCode.deleteMany({ where: { userId: row.userId } }),
  ]);
  await say(deps, message.chat.id, t("linked", { username: row.user.username }));
}

async function followCommand(deps: BridgeDeps, message: TgMessage, userId: string, name: string, on: boolean) {
  const t = botWords(message.from?.language_code);
  const username = name.replace(/^@/, "").trim();
  const creator = username
    ? await prisma.creatorProfile.findFirst({ where: { user: { username, deletedAt: null } }, select: { id: true, userId: true, displayName: true } })
    : null;
  if (!creator) return say(deps, message.chat.id, t("noSuchAuthor", { username }));
  if (creator.userId === userId) return say(deps, message.chat.id, t("notYourself"));
  if (on) {
    await prisma.follow.upsert({ where: { userId_creatorId: { userId, creatorId: creator.id } }, create: { userId, creatorId: creator.id }, update: {} });
  } else {
    await prisma.follow.deleteMany({ where: { userId, creatorId: creator.id } });
  }
  await say(deps, message.chat.id, t(on ? "followed" : "unfollowed", { name: `${creator.displayName} (@${username})` }));
}

/** The largest size of a photo, or the one file of a message, as a file to attach. */
function fileOf(message: TgMessage, n: number): { fileId: string; filename: string; mimeType: string } | null {
  if (message.photo?.length) {
    const largest = [...message.photo].sort((a, b) => b.width * b.height - a.width * a.height)[0]!;
    return { fileId: largest.file_id, filename: `photo-${message.message_id}-${n}.jpg`, mimeType: "image/jpeg" };
  }
  const file = message.document ?? message.video ?? message.audio;
  if (!file) return null;
  const fallback = message.video ? "video.mp4" : message.audio ? "audio.mp3" : "file";
  return { fileId: file.file_id, filename: file.file_name || fallback, mimeType: file.mime_type || "application/octet-stream" };
}

/**
 * Messages an author wrote to the bot, as one post: the first line is its
 * title, the rest (Telegram's bold, italic, links… kept as the post's own
 * marks) its text, the pictures and files its attachments.
 */
async function publishPost(deps: BridgeDeps, messages: TgMessage[]) {
  const first = messages[0]!;
  const t = botWords(first.from?.language_code);
  const worded = messages.find((m) => m.text || m.caption);
  const plain = worded?.text ?? worded?.caption ?? "";
  const entities = worded?.entities ?? worded?.caption_entities ?? [];
  if (!plain.trim()) return say(deps, first.chat.id, t("needsText"));

  const breakAt = plain.indexOf("\n");
  const title = (breakAt === -1 ? plain : plain.slice(0, breakAt)).trim().slice(0, 160);
  // The marks of the whole message, then the title's line taken off — the
  // entities' offsets are counted over the whole text.
  const markdown = telegramToMarkdown(plain, entities);
  const mdBreak = markdown.indexOf("\n");
  const rest = mdBreak === -1 ? "" : markdown.slice(mdBreak + 1).trim();
  const content = rest && hasOwnText(rest) ? rest : markdown;

  const files: { storageKey: string; mimeType: string; filename: string }[] = [];
  try {
    for (const [n, message] of messages.entries()) {
      const file = fileOf(message, n + 1);
      if (!file) continue;
      const { bytes } = await deps.bot.download(file.fileId);
      const ext = (file.filename.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
      files.push({ storageKey: await deps.storage.save(bytes, ext), mimeType: file.mimeType, filename: file.filename });
    }
    const result = await deps.publish({ chatId: String(first.chat.id), title, content, files: files.slice(0, 10) });
    if (!result.ok) return say(deps, first.chat.id, t("publishFailed", { reason: result.message }));
    const url = result.draft ? `${deps.webOrigin}/dashboard/posts/${result.productId}/edit` : `${deps.webOrigin}${postPathFor(result.username, result.productId)}`;
    await say(deps, first.chat.id, t(result.draft ? "drafted" : "published", { url }));
  } catch (err) {
    for (const f of files) await deps.storage.delete(f.storageKey).catch(() => undefined);
    await say(deps, first.chat.id, t("publishFailed", { reason: err instanceof Error ? err.message : "?" }));
  }
}

export async function handleMessage(deps: BridgeDeps, message: TgMessage, now = Date.now()) {
  if (message.chat.type !== "private") return;
  const t = botWords(message.from?.language_code);
  const text = message.text?.trim() ?? "";
  const command = /^\/(\w+)(?:@\w+)?(?:\s+(.*))?$/s.exec(text);

  if (command?.[1] === "start" && command[2]) return link(deps, message, command[2].trim());
  const linked = await prisma.telegramLink.findUnique({ where: { chatId: BigInt(message.chat.id) } });
  if (command) {
    const [, name, arg = ""] = command;
    if (name === "start") return say(deps, message.chat.id, linked ? t("help") : t("hello", { site: "Cryptovich" }));
    if (name === "help") return say(deps, message.chat.id, t("help"));
    if (!linked) return say(deps, message.chat.id, t("notLinked"));
    if (name === "stop") {
      await prisma.telegramLink.delete({ where: { id: linked.id } });
      return say(deps, message.chat.id, t("unlinked"));
    }
    if (name === "follow" || name === "unfollow") return followCommand(deps, message, linked.userId, arg, name === "follow");
    if (name === "list") {
      const follows = await prisma.follow.findMany({
        where: { userId: linked.userId },
        select: { creator: { select: { displayName: true, user: { select: { username: true } } } } },
      });
      return say(
        deps,
        message.chat.id,
        follows.length ? t("following", { list: follows.map((f) => `• ${f.creator.displayName} (@${f.creator.user.username})`).join("\n") }) : t("followingNone"),
      );
    }
    return say(deps, message.chat.id, t("help"));
  }

  if (!linked) return say(deps, message.chat.id, t("notLinked"));
  if (!linked.publishEnabled) return say(deps, message.chat.id, t("publishOff"));
  if (message.media_group_id) {
    const album = albums.get(message.media_group_id) ?? { messages: [], lastAt: now };
    album.messages.push(message);
    album.lastAt = now;
    albums.set(message.media_group_id, album);
    return;
  }
  await publishPost(deps, [message]);
}

/** Albums no part of which has come for a moment are whole: each becomes a post. */
export async function flushAlbums(deps: BridgeDeps, now = Date.now()) {
  for (const [id, album] of albums) {
    if (now - album.lastAt < ALBUM_SETTLE_MS) continue;
    albums.delete(id);
    await publishPost(deps, album.messages.sort((a, b) => a.message_id - b.message_id));
  }
}

/**
 * One round of the bridge: what Telegram has for the bot (a long poll, or
 * a short one while an album is still arriving), each message handled,
 * the offset kept so nothing is handled twice.
 */
export async function pollTelegram(options: { deps?: BridgeDeps; timeoutSeconds?: number } = {}): Promise<number> {
  const token = options.deps ? "given" : await bridgeToken();
  if (!token) return -1;
  const deps = options.deps ?? defaultDeps(token);
  const row = await prisma.serverSetting.findUnique({ where: { key: OFFSET_KEY } });
  const timeout = albums.size ? 1 : (options.timeoutSeconds ?? 20);
  const updates = await deps.bot.call<TgUpdate[]>(
    "getUpdates",
    { offset: row ? Number(row.value) : undefined, timeout, allowed_updates: ["message"] },
    (timeout + 15) * 1000,
  );
  for (const update of updates) {
    // Past it before handling it: one message that keeps failing must not stop the bridge.
    const next = String(update.update_id + 1);
    await prisma.serverSetting.upsert({ where: { key: OFFSET_KEY }, create: { key: OFFSET_KEY, value: next }, update: { value: next } });
    if (update.message) await handleMessage(deps, update.message).catch((err) => console.error("[telegram] message", err));
  }
  await flushAlbums(deps);
  return updates.length;
}
