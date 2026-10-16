import type { StickerProvider, StickerPackSummary, StickerPackDetail, ImportedPack, StickerItem, StickerKind } from "./provider.js";
import { StickerProviderError } from "./provider.js";

interface TelegramSticker {
  file_id: string;
  file_unique_id: string;
  emoji?: string;
  is_animated: boolean;
  is_video: boolean;
}

interface TelegramStickerSet {
  name: string;
  title: string;
  stickers: TelegramSticker[];
}

interface TelegramFile {
  file_id: string;
  file_path?: string;
}

function stickerKind(s: TelegramSticker): StickerKind {
  if (s.is_video) return "VIDEO";
  if (s.is_animated) return "ANIMATED";
  return "STATIC";
}

/**
 * Real implementation against the Telegram Bot API — needs only a bot
 * token (`getStickerSet` is a plain, unauthenticated-beyond-the-token Bot
 * API call; no user OAuth is required). There is no Bot API endpoint to
 * "list sticker packs a user owns", so `listPacks` is intentionally
 * unsupported here: a creator provides the pack's short name (from its
 * `t.me/addstickers/<name>` link) directly (spec rule #28).
 */
export class TelegramStickerProvider implements StickerProvider {
  constructor(private readonly botToken: string) {}

  private apiUrl(method: string): string {
    return `https://api.telegram.org/bot${this.botToken}/${method}`;
  }

  private fileUrl(filePath: string): string {
    return `https://api.telegram.org/file/bot${this.botToken}/${filePath}`;
  }

  async connect(): Promise<void> {
    const res = await fetch(this.apiUrl("getMe"));
    const body = (await res.json()) as { ok: boolean; description?: string };
    if (!res.ok || !body.ok) {
      throw new StickerProviderError(body.description ?? "Could not verify the Telegram bot token.");
    }
  }

  async listPacks(): Promise<StickerPackSummary[]> {
    throw new StickerProviderError(
      "Telegram's Bot API has no endpoint to list a user's sticker packs — provide the pack's short name instead.",
    );
  }

  private async fetchStickerSet(sourceRef: string): Promise<TelegramStickerSet> {
    const res = await fetch(this.apiUrl(`getStickerSet?name=${encodeURIComponent(sourceRef)}`));
    const body = (await res.json()) as { ok: boolean; result?: TelegramStickerSet; description?: string };
    if (!res.ok || !body.ok || !body.result) {
      throw new StickerProviderError(body.description ?? `Could not find Telegram sticker set "${sourceRef}".`);
    }
    return body.result;
  }

  private async resolveFileUrl(fileId: string): Promise<string> {
    const res = await fetch(this.apiUrl(`getFile?file_id=${encodeURIComponent(fileId)}`));
    const body = (await res.json()) as { ok: boolean; result?: TelegramFile; description?: string };
    if (!res.ok || !body.ok || !body.result?.file_path) {
      throw new StickerProviderError(body.description ?? "Could not resolve Telegram file URL.");
    }
    return this.fileUrl(body.result.file_path);
  }

  async getPack(sourceRef: string): Promise<StickerPackDetail> {
    const set = await this.fetchStickerSet(sourceRef);
    const stickers = await Promise.all(
      set.stickers.map(async (s): Promise<StickerItem> => ({
        externalId: s.file_unique_id,
        name: s.emoji ?? set.name,
        kind: stickerKind(s),
        url: await this.resolveFileUrl(s.file_id),
      })),
    );
    return { externalId: set.name, title: set.title, stickers };
  }

  async listStickers(sourceRef: string): Promise<StickerItem[]> {
    return (await this.getPack(sourceRef)).stickers;
  }

  async importPack(sourceRef: string): Promise<ImportedPack> {
    const pack = await this.getPack(sourceRef);
    return { ...pack, sourceUrl: `https://t.me/addstickers/${sourceRef}` };
  }

  async importSticker(sourceRef: string, stickerExternalId: string): Promise<StickerItem> {
    const set = await this.fetchStickerSet(sourceRef);
    const sticker = set.stickers.find((s) => s.file_unique_id === stickerExternalId);
    if (!sticker) throw new StickerProviderError(`No such sticker in set "${sourceRef}": ${stickerExternalId}`);
    return {
      externalId: sticker.file_unique_id,
      name: sticker.emoji ?? set.name,
      kind: stickerKind(sticker),
      url: await this.resolveFileUrl(sticker.file_id),
    };
  }
}
