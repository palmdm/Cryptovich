import type { Prisma, PrismaClient } from "@platform/db";
import { Errors } from "../../lib/errors.js";
import { storageService, type StorageBackend } from "../../lib/storage.js";
import { MIME_TO_EXT } from "../../lib/image-mime.js";
import { processImage } from "../../lib/image-resize.js";
import { resolveCurrentUsername } from "../../lib/username-history.js";
import {
  evaluateAchievements,
  parseBirthDate,
  parseSpotifyUrl,
  spotifyUrl as canonicalSpotifyUrl,
  utcCalendarDate,
  type AchievementFamily,
} from "@platform/shared";
import type { BecomeCreatorInput, UpdateCreatorProfileInput } from "./schemas.js";
import { megabytes, SettingsService } from "../settings/service.js";

/**
 * What a reader is told about the author: the parts they filled in, and
 * when they joined. A hidden birth year is left out here, not merely not
 * drawn — the page works out the sign and the age from what it is sent.
 */
export function aboutOf(
  profile: { birthDate: Date | null; showBirthYear: boolean; city: string | null; country: string | null },
  joinedAt: Date,
) {
  const born = profile.birthDate ? utcCalendarDate(profile.birthDate) : null;
  return {
    birthday: born ? { month: born.month, day: born.day, year: profile.showBirthYear ? born.year : null } : null,
    city: profile.city,
    country: profile.country,
    joinedAt,
  };
}

export class CreatorService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: StorageBackend = storageService,
  ) {}

  /**
   * Sets up the caller's public profile. Registration already creates one
   * (display name defaulting to the username), so this no longer *makes*
   * someone a creator — it applies the name and bio they chose. It stays
   * an upsert rather than a plain create so it works either way, and it
   * must apply the input rather than short-circuit on an existing row:
   * returning early would silently discard the display name the author
   * just typed, leaving them published under their raw username.
   */
  async becomeCreator(userId: string, input: BecomeCreatorInput) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const [profile] = await this.prisma.$transaction([
      this.prisma.creatorProfile.upsert({
        where: { userId },
        update: { displayName: input.displayName, bio: input.bio },
        create: { userId, displayName: input.displayName, bio: input.bio },
      }),
      // Only promotes a plain USER — an ADMIN or MODERATOR who becomes a
      // creator keeps their existing role. Unconditionally setting
      // role: "CREATOR" here used to silently demote an admin the moment
      // they created a creator profile, quietly losing every admin-only
      // capability with no warning.
      ...(user.role === "USER" ? [this.prisma.user.update({ where: { id: userId }, data: { role: "CREATOR" } })] : []),
    ]);
    return profile;
  }

  async updateProfile(userId: string, input: UpdateCreatorProfileInput) {
    const profile = await this.prisma.creatorProfile.findUnique({ where: { userId } });
    if (!profile) throw Errors.notFound("Creator profile");
    const { birthDate, city, country, spotifyUrl, ...rest } = input;
    const data: Prisma.CreatorProfileUpdateInput = { ...rest };
    if (birthDate !== undefined) {
      if (birthDate === "") {
        data.birthDate = null;
      } else {
        const date = parseBirthDate(birthDate, utcCalendarDate(new Date()));
        if (!date) throw Errors.validation("That birth date doesn't exist or is in the future.");
        data.birthDate = new Date(Date.UTC(date.year, date.month - 1, date.day));
      }
    }
    if (city !== undefined) data.city = city || null;
    if (country !== undefined) data.country = country || null;
    if (spotifyUrl !== undefined) {
      const ref = spotifyUrl ? parseSpotifyUrl(spotifyUrl) : null;
      data.spotifyUrl = ref ? canonicalSpotifyUrl(ref) : null;
    }
    return this.prisma.creatorProfile.update({ where: { userId }, data });
  }

  /**
   * Avatars are never gated (they're always shown on a public profile), so
   * unlike post attachments this stores a directly-servable path rather
   * than routing every request back through EntitlementService.
   */
  async uploadAvatar(userId: string, file: { buffer: Buffer; mimeType: string }) {
    const profile = await this.prisma.creatorProfile.findUnique({ where: { userId } });
    if (!profile) throw Errors.notFound("Creator profile");
    const extension = MIME_TO_EXT[file.mimeType];
    if (!extension) throw Errors.validation("Avatars must be a PNG, JPEG, GIF, or WebP image.");
    const limit = await new SettingsService(this.prisma).maxUploadBytes(userId);
    if (file.buffer.byteLength > limit) {
      throw Errors.validation(`Avatars must be ${megabytes(limit)} or smaller.`);
    }

    // Stored at the size it is shown at, not the size it arrived at.
    const processed = await processImage(file.buffer, file.mimeType, "avatar");
    const storageKey = await this.storage.save(processed.buffer, processed.extension);
    return this.prisma.creatorProfile.update({ where: { userId }, data: { avatarUrl: `/avatars/${storageKey}` } });
  }

  /**
   * The banner across the top of the author's page. Same handling as an
   * avatar — always public, so it is stored as a directly-servable path
   * rather than routed through EntitlementService.
   */
  async uploadCover(userId: string, file: { buffer: Buffer; mimeType: string }) {
    const profile = await this.prisma.creatorProfile.findUnique({ where: { userId } });
    if (!profile) throw Errors.notFound("Creator profile");
    const extension = MIME_TO_EXT[file.mimeType];
    if (!extension) throw Errors.validation("Covers must be a PNG, JPEG, GIF, or WebP image.");
    const limit = await new SettingsService(this.prisma).maxUploadBytes(userId);
    if (file.buffer.byteLength > limit) {
      throw Errors.validation(`Covers must be ${megabytes(limit)} or smaller.`);
    }

    const processed = await processImage(file.buffer, file.mimeType, "cover");
    const storageKey = await this.storage.save(processed.buffer, processed.extension);
    return this.prisma.creatorProfile.update({ where: { userId }, data: { coverUrl: `/covers/${storageKey}` } });
  }

  /** Clears the cover, falling the page back to its plain banner. */
  async removeCover(userId: string) {
    const profile = await this.prisma.creatorProfile.findUnique({ where: { userId } });
    if (!profile) throw Errors.notFound("Creator profile");
    return this.prisma.creatorProfile.update({ where: { userId }, data: { coverUrl: null } });
  }

  async getMyProfile(userId: string) {
    const profile = await this.prisma.creatorProfile.findUnique({ where: { userId } });
    if (!profile) throw Errors.notFound("Creator profile");
    return profile;
  }

  async getPublicProfile(requestedUsername: string) {
    // A bookmarked profile link has to keep working after the author
    // renames — this is the one lookup that falls back to a previous
    // username. The response's own `username` field then carries the
    // *current* name, which is what the frontend uses to redirect the
    // address bar to the canonical URL.
    const username = await resolveCurrentUsername(this.prisma, requestedUsername);
    if (!username) throw Errors.notFound("Creator");

    const user = await this.prisma.user.findUnique({
      where: { username },
      include: { creatorProfile: true },
    });
    if (!user || !user.creatorProfile || user.deletedAt) throw Errors.notFound("Creator");

    const profile = user.creatorProfile;
    const [subscriberCount, publishedProductCount] = await Promise.all([
      profile.showSubscriberCount
        ? this.prisma.subscription.count({
            where: { status: "ACTIVE", tier: { creatorId: profile.id } },
          })
        : Promise.resolve(null),
      this.prisma.digitalProduct.count({
        // Mirrors the store listing's filter — without `deletedAt` this
        // advertised more posts than the page actually shows.
        where: { creatorId: profile.id, status: "PUBLISHED", deletedAt: null },
      }),
    ]);

    const achievements = await this.achievementsFor(profile.id, user.createdAt);

    return {
      username: user.username,
      displayName: profile.displayName,
      achievements,
      bio: profile.bio,
      avatarUrl: profile.avatarUrl,
      avatarFrame: profile.avatarFrame,
      coverUrl: profile.coverUrl,
      links: profile.links,
      chatUrl: profile.chatUrl,
      subscriberCount,
      publishedProductCount,
      // The actual instructions text is only returned by the checkout
      // endpoint when a payer chooses the manual method — this just tells
      // the frontend whether to offer that option at all.
      acceptsManualPayments: Boolean(profile.manualPaymentInstructions),
      about: aboutOf(profile, user.createdAt),
      spotifyUrl: profile.spotifyUrl,
    };
  }

  /**
   * Achievements, measured from the rows themselves rather than from a
   * stored counter — a tally kept beside the data it counts eventually
   * disagrees with it, and a badge contradicting the page under it is
   * worse than no badge.
   *
   * Every measurement is counted in one round trip.
   */
  async achievementsFor(creatorId: string, joinedAt: Date) {
    const published = { creatorId, status: "PUBLISHED" as const, deletedAt: null };
    const [posts, subscribers, tips, conversation, federation, reactions, views, sales, followers, pinned, sections, folders] =
      await Promise.all([
        this.prisma.digitalProduct.count({ where: published }),
        this.prisma.subscription.count({
          where: { status: "ACTIVE", expiresAt: { gt: new Date() }, tier: { creatorId } },
        }),
        // Settled tips only: a pending one has not arrived.
        this.prisma.donation.aggregate({
          where: { creatorId, status: "COMPLETED" },
          _sum: { amountMinor: true },
        }),
        this.prisma.comment.count({ where: { deletedAt: null, product: { creatorId } } }),
        this.prisma.creatorFederationSettings.count({ where: { creatorId, enabled: true } }),
        this.prisma.reaction.count({ where: { product: { creatorId } } }),
        this.prisma.digitalProduct.aggregate({ where: published, _sum: { viewCount: true } }),
        this.prisma.purchase.count({ where: { status: "COMPLETED", product: { creatorId } } }),
        this.prisma.federationFollower.count({ where: { creatorId } }),
        this.prisma.digitalProduct.count({ where: { ...published, featured: true } }),
        this.prisma.productCategory.count({ where: { creatorId } }),
        this.prisma.folder.count({ where: { creatorId, deletedAt: null } }),
      ]);

    const months = Math.floor((Date.now() - joinedAt.getTime()) / (30 * 24 * 60 * 60 * 1000));

    const values: Record<AchievementFamily, number> = {
      POSTS: posts,
      SUBSCRIBERS: subscribers,
      TIPS: Number(tips._sum?.amountMinor ?? 0n),
      CONVERSATION: conversation,
      TENURE: months,
      FEDERATION: federation,
      REACTIONS: reactions,
      VIEWS: views._sum?.viewCount ?? 0,
      SALES: sales,
      FOLLOWERS: followers,
      PINNED: pinned,
      COLLECTIONS: sections + folders,
    };

    return evaluateAchievements(values);
  }

  /**
   * The public directory. Anyone — signed in or not — can browse it; it is
   * the only way to find an author without already knowing their username.
   * Only creators with something published appear, so the list never sends
   * a reader to an empty page.
   */
  async listPublicCreators(limit = 60) {
    const profiles = await this.prisma.creatorProfile.findMany({
      where: {
        user: { deletedAt: null },
        products: { some: { status: "PUBLISHED", deletedAt: null } },
      },
      include: {
        user: { select: { username: true } },
        _count: { select: { products: { where: { status: "PUBLISHED", deletedAt: null } } } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return profiles.map((profile) => ({
      username: profile.user.username,
      displayName: profile.displayName,
      bio: profile.bio,
      avatarUrl: profile.avatarUrl,
      avatarFrame: profile.avatarFrame,
      publishedProductCount: profile._count.products,
    }));
  }
}
