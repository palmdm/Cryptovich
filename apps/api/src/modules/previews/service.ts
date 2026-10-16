import { SettingsService } from "../settings/service.js";
import type { PrismaClient } from "@platform/db";
import { isPostId, postPathFor, safeHttpUrl } from "@platform/shared";
import { EntitlementService } from "../entitlements/service.js";
import { Errors } from "../../lib/errors.js";
import { resolveCurrentUsername } from "../../lib/username-history.js";
import { postExcerpt } from "../../lib/excerpt.js";
import { previewText } from "../../lib/preview-text.js";
import { config } from "../../config.js";

/**
 * What a link to this site shows when it is pasted into Telegram, X,
 * Mastodon, Discord… — the page's Open Graph card.
 *
 * The card is fetched by a crawler with no session, so it is built for an
 * anonymous reader and nothing else: whatever a signed-out visitor of the
 * page would see, and never more. A post that reader cannot open keeps the
 * parts every listing already shows (title, description, cover, author)
 * and loses its body and its pictures, exactly as the post endpoint does.
 */
export interface LinkPreview {
  kind: "post" | "profile" | "folder";
  title: string;
  description: string | null;
  /** Absolute: the crawler fetches it directly, from no particular page. */
  image: string | null;
  /** A cover or a post's picture, worth a large card — not an avatar. */
  imageWide: boolean;
  /** The page's address today, after any rename or older link form. */
  path: string;
  author: { username: string; displayName: string };
  publishedAt: Date | null;
  /** The body is not part of the card because a signed-out reader may not read it. */
  locked: boolean;
  /** The author keeps out of search engines: the page says noindex. */
  noindex: boolean;
}

/**
 * A stored image as a URL a crawler can fetch: our own paths are served by
 * the API, whose public address is API_PUBLIC_URL; an author's own absolute
 * URL is kept only if it is http(s).
 */
function publicImageUrl(stored: string | null | undefined): string | null {
  const safe = safeHttpUrl(stored);
  if (!safe) return null;
  return safe.startsWith("/") ? `${config.apiPublicUrl.replace(/\/$/, "")}${safe}` : safe;
}

export class PreviewService {
  private entitlements: EntitlementService;

  constructor(private prisma: PrismaClient) {
    this.entitlements = new EntitlementService(prisma);
  }

  /** The administrator keeps the whole server out of search engines. */
  async serverHidden(): Promise<boolean> {
    return (await new SettingsService(this.prisma).parameter("hideFromSearchEngines")) === "true";
  }

  private async author(requestedUsername: string) {
    const username = await resolveCurrentUsername(this.prisma, requestedUsername);
    if (!username) return null;
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: {
        username: true,
        deletedAt: true,
        creatorProfile: { select: { id: true, displayName: true, bio: true, avatarUrl: true, coverUrl: true, hideFromSearch: true } },
      },
    });
    if (!user || user.deletedAt || !user.creatorProfile) return null;
    return { username: user.username, ...user.creatorProfile };
  }

  async profile(requestedUsername: string): Promise<LinkPreview> {
    const author = await this.author(requestedUsername);
    if (!author) throw Errors.notFound("Creator");
    const cover = publicImageUrl(author.coverUrl);
    return {
      kind: "profile",
      title: author.displayName,
      description: previewText(author.bio),
      image: cover ?? publicImageUrl(author.avatarUrl),
      imageWide: Boolean(cover),
      path: `/${author.username}`,
      author: { username: author.username, displayName: author.displayName },
      publishedAt: null,
      locked: false,
      noindex: author.hideFromSearch || (await this.serverHidden()),
    };
  }

  async post(requestedUsername: string, ref: string): Promise<LinkPreview> {
    const author = await this.author(requestedUsername);
    if (!author) throw Errors.notFound("Product");
    const product = await this.prisma.digitalProduct.findFirst({
      where: { ...(isPostId(ref) ? { id: ref } : { slug: ref }), creatorId: author.id, deletedAt: null },
      select: {
        id: true,
        title: true,
        description: true,
        coverUrl: true,
        publishedAt: true,
        post: {
          select: {
            excerpt: true,
            content: true,
            attachments: { where: { kind: "IMAGE" }, orderBy: { position: "asc" }, take: 1, select: { id: true } },
          },
        },
      },
    });
    if (!product) throw Errors.notFound("Product");

    // The one access authority, asked as nobody: a draft or a disabled
    // post has no card at all — not even its title — and a gated one
    // keeps only what its listing card shows everyone.
    const decision = await this.entitlements.canAccessProduct(null, product.id);
    if (decision.reason === "PRODUCT_NOT_FOUND" || decision.reason === "PRODUCT_DISABLED") {
      throw Errors.notFound("Product");
    }
    const open = decision.allowed;

    const cover = publicImageUrl(product.coverUrl);
    const firstImage = open ? product.post?.attachments[0] : undefined;
    const picture =
      cover ??
      (firstImage ? publicImageUrl(`/products/${product.id}/attachments/${firstImage.id}/file`) : null);

    return {
      kind: "post",
      title: product.title,
      description:
        previewText(product.description) ?? (open ? previewText(postExcerpt(product.post)) : null),
      image: picture ?? publicImageUrl(author.avatarUrl),
      imageWide: Boolean(picture),
      path: postPathFor(author.username, product.id),
      author: { username: author.username, displayName: author.displayName },
      publishedAt: product.publishedAt,
      locked: !open,
      noindex: author.hideFromSearch || (await this.serverHidden()),
    };
  }

  async folder(requestedUsername: string, slug: string): Promise<LinkPreview> {
    const author = await this.author(requestedUsername);
    if (!author) throw Errors.notFound("Folder");
    const folder = await this.prisma.folder.findUnique({
      where: { creatorId_slug: { creatorId: author.id, slug } },
      select: { title: true, slug: true, description: true, deletedAt: true },
    });
    if (!folder || folder.deletedAt) throw Errors.notFound("Folder");
    return {
      kind: "folder",
      title: folder.title,
      description: previewText(folder.description),
      image: publicImageUrl(author.avatarUrl),
      imageWide: false,
      path: `/${author.username}/f/${folder.slug}`,
      author: { username: author.username, displayName: author.displayName },
      publishedAt: null,
      locked: false,
      noindex: author.hideFromSearch || (await this.serverHidden()),
    };
  }
}
