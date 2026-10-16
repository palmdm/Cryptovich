import type { StickerProvider, StickerPackSummary, StickerPackDetail, ImportedPack, StickerItem } from "./provider.js";
import { StickerProviderError } from "./provider.js";
import { safeFetch } from "../feed/safe-fetch.js";
import { assertPublicHttpUrl } from "../feed/ssrf-guard.js";

interface SharkeyEmoji {
  name: string;
  url: string;
  category?: string | null;
  license?: string | null;
}

interface MastodonEmoji {
  shortcode: string;
  url: string;
  static_url?: string;
  visible_in_picker?: boolean;
  category?: string | null;
}

export type FediverseSoftware = "misskey" | "mastodon";

const ALL_EMOJI_PACK_ID = "custom-emoji";

/**
 * A fediverse instance's custom emoji: Sharkey and Misskey through their
 * public `/api/emojis` (Misskey-family convention: POST + JSON body, even
 * for reads — spec rule #29), and, when an instance has no such API, a
 * Mastodon one through `GET /api/v1/custom_emojis`. Both are public, no
 * sign-in. Emoji are not packs on the server; every emoji comes in one
 * synthetic pack carrying its own category, and `categories()` says which
 * there are, so an administrator imports the sets they want rather than
 * the whole instance.
 */
export class SharkeyStickerProvider implements StickerProvider {
  /**
   * `guard` is the SSRF check every request passes — the instance is an
   * address typed by an administrator, and its replies can redirect; a
   * private or internal address is refused like anywhere else here.
   */
  constructor(
    private readonly instanceUrl: string,
    private readonly guard: (url: string) => Promise<void> = assertPublicHttpUrl,
  ) {}

  private endpoint(path: string): string {
    return `${this.instanceUrl.replace(/\/$/, "")}${path}`;
  }

  private async post<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
    const res = await safeFetch(
      this.endpoint(path),
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), timeoutMs: 15_000 },
      this.guard,
    );
    if (!res.ok) {
      throw new StickerProviderError(`Sharkey instance returned ${res.status} for ${path}`);
    }
    return (await res.json()) as T;
  }

  async connect(): Promise<void> {
    await this.post("/api/meta");
  }

  async listPacks(): Promise<StickerPackSummary[]> {
    return [{ externalId: ALL_EMOJI_PACK_ID, title: `Custom emoji on ${this.instanceUrl}` }];
  }

  private software: FediverseSoftware | null = null;

  /** Misskey's list first; an instance without it (404/405/400) is asked Mastodon's way. */
  private async fetchEmojis(): Promise<SharkeyEmoji[]> {
    const misskey = await safeFetch(
      this.endpoint("/api/emojis"),
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", timeoutMs: 15_000 },
      this.guard,
    );
    if (misskey.ok) {
      const body = (await misskey.json().catch(() => null)) as { emojis?: SharkeyEmoji[] } | null;
      if (body && Array.isArray(body.emojis)) {
        this.software = "misskey";
        return body.emojis;
      }
    } else if (![400, 404, 405].includes(misskey.status)) {
      throw new StickerProviderError(`The instance returned ${misskey.status} for /api/emojis`);
    }
    const mastodon = await safeFetch(this.endpoint("/api/v1/custom_emojis"), { method: "GET", timeoutMs: 15_000 }, this.guard);
    if (!mastodon.ok) throw new StickerProviderError(`Neither Misskey's nor Mastodon's emoji list answered (HTTP ${mastodon.status})`);
    const list = (await mastodon.json().catch(() => null)) as MastodonEmoji[] | null;
    if (!Array.isArray(list)) throw new StickerProviderError("The instance's emoji list could not be read.");
    this.software = "mastodon";
    // An emoji hidden from Mastodon's picker is one its admins chose not to offer.
    return list
      .filter((e) => e && typeof e.shortcode === "string" && typeof e.url === "string" && e.visible_in_picker !== false)
      .map((e) => ({ name: e.shortcode, url: e.url, category: e.category ?? null }));
  }

  /** The sets the instance groups its emoji in, with how many each holds; "" is the ungrouped. */
  async categories(): Promise<{ software: FediverseSoftware; total: number; categories: { name: string; count: number }[] }> {
    const emojis = await this.fetchEmojis();
    const counts = new Map<string, number>();
    for (const e of emojis) counts.set(e.category?.trim() ?? "", (counts.get(e.category?.trim() ?? "") ?? 0) + 1);
    return {
      software: this.software ?? "misskey",
      total: emojis.length,
      categories: [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  async getPack(sourceRef: string): Promise<StickerPackDetail> {
    if (sourceRef !== ALL_EMOJI_PACK_ID) throw new StickerProviderError(`Unknown pack: ${sourceRef}`);
    const emojis = await this.fetchEmojis();
    return {
      externalId: ALL_EMOJI_PACK_ID,
      title: `Custom emoji on ${this.instanceUrl}`,
      stickers: emojis.map((e) => ({
        externalId: e.name,
        name: e.name,
        kind: "CUSTOM_EMOJI",
        url: e.url,
        ...(e.category ? { category: e.category } : {}),
      })),
    };
  }

  async listStickers(sourceRef: string): Promise<StickerItem[]> {
    return (await this.getPack(sourceRef)).stickers;
  }

  async importPack(sourceRef: string): Promise<ImportedPack> {
    const pack = await this.getPack(sourceRef);
    return { ...pack, sourceInstance: this.instanceUrl, sourceUrl: this.instanceUrl };
  }

  async importSticker(sourceRef: string, stickerExternalId: string): Promise<StickerItem> {
    const pack = await this.getPack(sourceRef);
    const sticker = pack.stickers.find((s) => s.externalId === stickerExternalId);
    if (!sticker) throw new StickerProviderError(`No such emoji: ${stickerExternalId}`);
    return sticker;
  }
}
