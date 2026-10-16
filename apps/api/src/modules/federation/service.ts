import type { PrismaClient } from "@platform/db";
import { authorFederates } from "@platform/shared";
import { generateActorKeyPair } from "@platform/integrations";
import { Errors } from "../../lib/errors.js";
import { requireCreatorProfile, requireOwnedProduct } from "../products/product-helpers.js";
import { resolveFederationProvider } from "./provider-factory.js";
import type { UpdateSettingsInput, AddInstanceInput } from "./schemas.js";

export function actorIdFor(username: string): string {
  return `${process.env.WEB_ORIGIN ?? "http://localhost:3000"}/@${username}`;
}

export class FederationSettingsService {
  constructor(private readonly prisma: PrismaClient) {}

  async get(userId: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const settings = await this.prisma.creatorFederationSettings.findUnique({ where: { creatorId: profile.id } });
    // An author who has never touched the page sees federation off but
    // auto-publish already on, matching the column default — so switching
    // federation on is the only decision they have to make.
    if (!settings) return { creatorId: profile.id, enabled: false, autoPublish: true, hasActor: false };
    return { ...settings, actorPrivateKeyPem: undefined, hasActor: Boolean(settings.actorPublicKeyPem) };
  }

  async update(userId: string, input: UpdateSettingsInput) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const existing = await this.prisma.creatorFederationSettings.findUnique({ where: { creatorId: profile.id } });

    // Actor keypair is generated exactly once, the first time federation
    // is turned on (spec rule #76) — never regenerated implicitly, which
    // would silently invalidate every prior signed delivery.
    const needsKeys = input.enabled && !existing?.actorPrivateKeyPem;
    const keys = needsKeys ? generateActorKeyPair() : null;

    const settings = await this.prisma.creatorFederationSettings.upsert({
      where: { creatorId: profile.id },
      update: {
        enabled: input.enabled,
        autoPublish: input.autoPublish,
        ...(keys ? { actorPublicKeyPem: keys.publicKeyPem, actorPrivateKeyPem: keys.privateKeyPem } : {}),
      },
      create: {
        creatorId: profile.id,
        // A row created by some other change (auto-publish, say) must not
        // switch the author off: no row meant federated.
        enabled: input.enabled ?? true,
        autoPublish: input.autoPublish ?? true,
        ...(keys ? { actorPublicKeyPem: keys.publicKeyPem, actorPrivateKeyPem: keys.privateKeyPem } : {}),
      },
    });

    return { ...settings, actorPrivateKeyPem: undefined, hasActor: Boolean(settings.actorPublicKeyPem) };
  }

  /**
   * Every author, and whether this server federates them — the list the
   * administrator works from now that federation is theirs to decide.
   */
  async listAll() {
    const profiles = await this.prisma.creatorProfile.findMany({
      where: { user: { deletedAt: null } },
      include: { user: { select: { username: true } }, federationSettings: true },
      orderBy: { displayName: "asc" },
    });

    return profiles.map((profile) => ({
      username: profile.user.username,
      displayName: profile.displayName,
      enabled: authorFederates(profile.federationSettings),
      autoPublish: profile.federationSettings?.autoPublish ?? true,
      hasActor: Boolean(profile.federationSettings?.actorPublicKeyPem),
    }));
  }

  /** The same change as `update`, addressed by username rather than by the
   * caller's own account — an administrator acting on someone else's. */
  async updateByUsername(username: string, input: UpdateSettingsInput) {
    const user = await this.prisma.user.findFirst({
      where: { username, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw Errors.notFound("Author");
    return this.update(user.id, input);
  }
}

export class FederationInstanceService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * A creator can only add an instance to their own allowlist — never
   * globally-enable federation to it (spec rule #68). New domains start
   * PENDING; only a platform admin approval (Phase 10) flips a domain to
   * APPROVED, and only APPROVED instances ever receive a delivery attempt.
   */
  async addToAllowlist(userId: string, input: AddInstanceInput) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const instance = await this.prisma.federationInstance.upsert({
      where: { domain: input.domain },
      update: {},
      create: { domain: input.domain, platform: input.platform, status: "PENDING" },
    });
    await this.prisma.creatorFederationInstance.upsert({
      where: { creatorId_instanceId: { creatorId: profile.id, instanceId: instance.id } },
      update: {},
      create: { creatorId: profile.id, instanceId: instance.id },
    });
    return instance;
  }

  async removeFromAllowlist(userId: string, instanceId: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    await this.prisma.creatorFederationInstance.deleteMany({ where: { creatorId: profile.id, instanceId } });
  }

  async listMine(userId: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const links = await this.prisma.creatorFederationInstance.findMany({
      where: { creatorId: profile.id },
      include: { instance: true },
    });
    return links.map((l) => l.instance);
  }
}

export class FederatedPostService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Enqueues delivery jobs (spec rule #71) — never calls a provider
   * inline. Enforces the free-public-only rule at the moment of
   * enqueueing, not just trusting the caller (spec rules #69, #73).
   */
  async publish(userId: string, productId: string, instanceIds?: string[]) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const product = await requireOwnedProduct(this.prisma, profile.id, productId);

    if (product.type !== "POST") throw Errors.validation("Only posts can be federated.");
    if (product.visibility !== "PUBLIC") {
      throw Errors.validation("Only public, free posts can be federated — this post isn't public.");
    }
    const price = await this.prisma.productPrice.findFirst({ where: { productId, active: true } });
    if (!price || price.pricingType !== "FREE") {
      throw Errors.validation("Only public, free posts can be federated — this post has a price.");
    }

    const settings = await this.prisma.creatorFederationSettings.findUnique({ where: { creatorId: profile.id } });
    if (!authorFederates(settings)) throw Errors.validation("This author is not published to the fediverse.");

    const allowlist = await this.prisma.creatorFederationInstance.findMany({
      where: { creatorId: profile.id, ...(instanceIds ? { instanceId: { in: instanceIds } } : {}) },
      include: { instance: true },
    });
    if (allowlist.length === 0) throw Errors.validation("Add at least one instance to your allowlist first.");

    const jobs = [];
    for (const link of allowlist) {
      jobs.push(
        await this.prisma.federatedPost.upsert({
          where: { postId_instanceId: { postId: productId, instanceId: link.instanceId } },
          update: { status: "PENDING", error: null, retryCount: 0, nextAttemptAt: null },
          create: { postId: productId, instanceId: link.instanceId, status: "PENDING" },
        }),
      );
    }
    return jobs;
  }

  /**
   * Retraction is synchronous (spec rule #74 already warns deletion isn't
   * guaranteed to be honored remotely) — the creator gets an immediate,
   * honest per-instance result rather than a queued promise.
   */
  async retract(userId: string, productId: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    await requireOwnedProduct(this.prisma, profile.id, productId);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const settings = await this.prisma.creatorFederationSettings.findUniqueOrThrow({ where: { creatorId: profile.id } });

    const federatedPosts = await this.prisma.federatedPost.findMany({
      where: { postId: productId, status: "PUBLISHED" },
      include: { instance: true },
    });

    const results = [];
    for (const fp of federatedPosts) {
      try {
        const provider = resolveFederationProvider(fp.instance, {
          actorId: actorIdFor(user.username),
          privateKeyPem: settings.actorPrivateKeyPem!,
        });
        await provider.deletePost(fp.remotePostId ?? fp.remoteUrl ?? productId);
        await this.prisma.federatedPost.update({ where: { id: fp.id }, data: { status: "RETRACTED", lastSyncedAt: new Date() } });
        results.push({ instanceId: fp.instanceId, ok: true });
      } catch (err) {
        results.push({ instanceId: fp.instanceId, ok: false, error: err instanceof Error ? err.message : "Retraction failed" });
      }
    }
    return results;
  }

  async listForPost(userId: string, productId: string) {
    const profile = await requireCreatorProfile(this.prisma, userId);
    await requireOwnedProduct(this.prisma, profile.id, productId);
    return this.prisma.federatedPost.findMany({ where: { postId: productId }, include: { instance: true } });
  }
}
