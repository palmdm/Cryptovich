export type StickerKind = "STATIC" | "ANIMATED" | "VIDEO" | "CUSTOM_EMOJI";

export interface StickerItem {
  externalId: string;
  name: string;
  kind: StickerKind;
  url: string;
  /** The group the source files it under, where it has one (Misskey/Sharkey categories). */
  category?: string;
}

export interface StickerPackSummary {
  externalId: string;
  title: string;
}

export interface StickerPackDetail extends StickerPackSummary {
  author?: string;
  license?: string;
  attribution?: string;
  stickers: StickerItem[];
}

export interface ImportedPack extends StickerPackDetail {
  sourceInstance?: string;
  sourceUrl?: string;
}

/**
 * Every external sticker/emoji source (Telegram, Sharkey, ...) implements
 * this interface. Business logic (the import job) depends only on this
 * shape, never on a provider's own API conventions (spec rules #27, #149).
 */
export interface StickerProvider {
  connect(): Promise<void>;
  listPacks(query?: string): Promise<StickerPackSummary[]>;
  getPack(sourceRef: string): Promise<StickerPackDetail>;
  listStickers(sourceRef: string): Promise<StickerItem[]>;
  importPack(sourceRef: string): Promise<ImportedPack>;
  importSticker(sourceRef: string, stickerExternalId: string): Promise<StickerItem>;
}

export class StickerProviderError extends Error {}
