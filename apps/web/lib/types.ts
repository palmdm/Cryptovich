export interface CurrentUser {
  id: string;
  username: string;
  email: string | null;
  role: "USER" | "CREATOR" | "ADMIN" | "MODERATOR";
  twoFactorEnabled: boolean;
  /**
   * Server-side file storage costs the operator money, so uploading is a
   * privilege an administrator grants rather than something every account
   * has. `/auth/me` has always sent this; the composer uses it to explain
   * why the drop zone is missing instead of failing on submit.
   */
  canUploadFiles: boolean;
  /** An administrator without a second factor: every page is the set-up screen until it is on. */
  twoFactorSetupRequired?: boolean;
  /** Signed in only until this browser closes (a temporary QR sign-in). */
  sessionTemporary?: boolean;
  /** Whether minting an API key would be accepted — an administrator, or
   * an author whose access request was approved. */
  canMintApiKeys?: boolean;
  /** The account's own picture and frame, for the header. */
  avatarUrl?: string | null;
  avatarFrame?: string | null;
}

export interface ProductPrice {
  id: string;
  currency: string;
  amountMinor: string;
  pricingType: "FREE" | "ONE_TIME" | "SUBSCRIPTION";
}

export interface ProductSummary {
  id: string;
  type: "POST" | "BUNDLE" | "STICKER_PACK" | "DIGITAL_FILE";
  title: string;
  slug: string;
  description: string | null;
  coverUrl: string | null;
  visibility: "PUBLIC" | "SUBSCRIBERS" | "TIER" | "PURCHASED" | "PRIVATE" | "GOAL";
  /** Whether this reader may open the post — the API's own decision.
   * Visibility alone never answers it: a subscriber, a buyer and the
   * author all see gated posts they can read. */
  canAccess?: boolean;
  /** The tier a TIER-gated post needs, so the lock can name it. */
  requiredTier?: { id: string; name: string } | null;
  /** The goal a GOAL post opens with. A post's own page sends the whole
   * goal with its progress (`Goal` in `fundraising-goal.tsx`). */
  requiredGoal?: { id: string; title: string } | null;
  /** The author's sale on a paid post: percent off until an optional moment. */
  discountPercent?: number | null;
  discountEndsAt?: string | null;
  /** Opening lines of the body, sent only when `canAccess`. */
  excerpt?: string | null;
  /** The post shows more than its card: longer text, or attachments. */
  hasMore?: boolean;
  /** Up to three pictures, sent only when `canAccess`. `url` is the gated download route. */
  images?: { id: string; url: string; alt: string }[];
  /** How many pictures the post has in all — the card says "+N" for the rest. */
  imageCount?: number;
  /** Whether the signed-in reader has saved it. */
  bookmarked?: boolean;
  /** Pinned by its author to the top of their profile. */
  pinned?: boolean;
  prices: ProductPrice[];
  publishedAt: string | null;
  status?: "DRAFT" | "PUBLISHED" | "ARCHIVED" | "DISABLED";
  // Present on both the public store responses and the creator's own
  // /products/mine listing.
  viewCount?: number;
  commentCount?: number;
  reactionCount?: number;
  /** Full per-post summary, so a feed card can render (and place) reactions without opening the post. */
  reactions?: { counts: { emoji: string; count: number }[]; mine: string[] };
  // /products/mine only — the author's own engagement figures.
  impressionCount?: number;
  bookmarkCount?: number;
  categories?: TaxonomyRef[];
  tags?: TaxonomyRef[];
}

export interface TaxonomyRef {
  id: string;
  name: string;
  slug?: string;
}

/** `/categories/mine` — includes both counts so an author can tell "empty" from "assigned, just not published yet". */
export interface MyCategory extends TaxonomyRef {
  totalItems: number;
  publishedItems: number;
}

export interface AccessDecision {
  allowed: boolean;
  reason: string;
}

export interface BundlePricing {
  currency: string;
  individualValueMinor: string;
  bundlePriceMinor: string;
  savingsMinor: string;
  itemCount: number;
}

export interface BundleItem {
  id: string;
  type: string;
  title: string;
  slug: string;
  coverUrl: string | null;
  owned: boolean;
}

export interface BundleDetail {
  pricing: BundlePricing | null;
  items: BundleItem[];
  ownedCount: number;
  totalCount: number;
}
