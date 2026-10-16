import type { PrismaClient } from "@platform/db";
import {
  generateActorKeyPair,
  getRequestSigner,
  signRequest,
  safeFetch,
  assertPublicHttpUrl,
  type ActorKeyPair,
  type RequestSigner,
} from "@platform/integrations";
import { isFederationAllowed } from "@platform/shared";
import { config } from "../../config.js";
import { actorUriFor, authorFederates, buildNote, buildPerson, featuredUriFor, INSTANCE_ACTOR_KEYS_SETTING, instanceActorUriFor, isPostId } from "@platform/shared";
import { AppError, Errors } from "../../lib/errors.js";
import { SettingsService } from "../settings/service.js";

/** How many recent posts a new follower's server is sent. */
const BACKFILL_POSTS = 20;
/** Long enough for the follower's server to process the Accept first. */
const BACKFILL_DELAY_MS = 30_000;

/**
 * Where the instance actor's keypair is kept: a `ServerSetting` row, but
 * not one of `SERVER_SETTINGS`, so `/admin/settings` never lists it.
 */
const INSTANCE_KEYS_SETTING = INSTANCE_ACTOR_KEYS_SETTING;
/** It never changes once made; one read per process is enough. */
let instanceKeysCache: ActorKeyPair | null = null;

/**
 * The most the `featured` collection carries: Mastodon's own limit on
 * pins, and the most an author here may pin (`SUPPORTER_PIN_LIMIT`).
 */
const FEATURED_POSTS = 5;

/** Posts per outbox page — Mastodon's own page size. */
const OUTBOX_PAGE = 20;

/**
 * The one rule for what leaves this server: a published, public post with
 * no active price other than FREE. Every way out goes through it — the
 * outbox, the featured collection, a Note fetched by its id, the pushes to
 * followers — so a priced post never federates by one path while another
 * holds it back. Text, images and the rest travel with it in full.
 */
function federatedPostWhere(creatorId?: string) {
  return {
    ...(creatorId ? { creatorId } : {}),
    type: "POST" as const,
    status: "PUBLISHED" as const,
    visibility: "PUBLIC" as const,
    deletedAt: null,
    prices: { none: { active: true, pricingType: { not: "FREE" as const } } },
  };
}

const AS_CONTEXT = [
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/security/v1",
] as const;

/**
 * The server-side half of federation: what other instances fetch and post
 * to in order to follow an author here.
 *
 * Every URL is built from `apiPublicUrl`, because an actor's `id` is its
 * identity across the whole network — if it does not resolve from the
 * outside, no remote server can verify a signature made with its key, and
 * every delivery this platform sends is dropped.
 */
export class ActivityPubService {
  /**
   * `guard` defaults to the real SSRF check. It is injectable for the
   * same reason the feed providers' is: a test that stubs the network
   * still pays for a real DNS lookup, and would end up asserting on the
   * guard rather than on this service.
   */
  constructor(
    private readonly prisma: PrismaClient,
    private readonly guard: (url: string) => Promise<void> = assertPublicHttpUrl,
    /** The server's logger, so a delivery that fails says so. Optional:
     * the federation tests construct this service directly. */
    private readonly log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void },
  ) {}

  actorUri(username: string): string {
    return actorUriFor(config.federationBaseUrl, username);
  }

  /** Resolves an author who has actually turned federation on. */
  async findFederatedCreator(username: string) {
    const result = await this.resolveFederatedCreator(username);
    return result.ok ? result : null;
  }

  /**
   * The author, or the specific reason they have no actor here.
   *
   * The reason matters: every one of these used to be the same 404,
   * "Account could not be found", so an operator could not tell a switched-
   * off server from a switched-off author from a typo in the name.
   */
  private async resolveFederatedCreator(username: string) {
    // The operator's switch comes first: with federation off, this server
    // has no actors at all. On unless an administrator turned it off.
    if (!(await new SettingsService(this.prisma).isFederationEnabled())) {
      return { ok: false, reason: "Federation is switched off on this server (Admin → Server settings)." } as const;
    }

    const user = await this.prisma.user.findFirst({
      where: { username, deletedAt: null, suspendedAt: null },
      include: { creatorProfile: { include: { federationSettings: true } } },
    });
    const profile = user?.creatorProfile;
    if (!user || !profile) return { ok: false, reason: "Account could not be found." } as const;

    // No settings row means federated — an administrator opts an author
    // out, not in. See `authorFederates`.
    if (!authorFederates(profile.federationSettings)) {
      return { ok: false, reason: "This author is not published to the fediverse (Admin → Federation)." } as const;
    }
    return { ok: true, user, profile, settings: profile.federationSettings } as const;
  }

  /** The author, or a 404 that says why there is no actor. */
  private async requireFederatedCreator(username: string) {
    const result = await this.resolveFederatedCreator(username);
    if (!result.ok) throw new AppError(404, result.reason, "NOT_FOUND");
    return result;
  }

  /**
   * A keypair is generated when federation is switched on. If an older
   * profile enabled it before keys existed, one is minted on first use —
   * an actor document without a public key is unusable to every remote
   * server, so this must never return an actor that has none.
   */
  private async ensureKeys(creatorId: string, existing: { actorPublicKeyPem: string | null; actorPrivateKeyPem: string | null } | null) {
    if (existing?.actorPublicKeyPem && existing.actorPrivateKeyPem) {
      return { publicKeyPem: existing.actorPublicKeyPem, privateKeyPem: existing.actorPrivateKeyPem };
    }
    const keys = generateActorKeyPair();
    // An upsert: an author federated by default has no settings row until
    // their actor is first served, which is exactly when this runs.
    await this.prisma.creatorFederationSettings.upsert({
      where: { creatorId },
      update: { actorPublicKeyPem: keys.publicKeyPem, actorPrivateKeyPem: keys.privateKeyPem },
      create: { creatorId, enabled: true, autoPublish: true, actorPublicKeyPem: keys.publicKeyPem, actorPrivateKeyPem: keys.privateKeyPem },
    });
    return keys;
  }

  /**
   * The installation's own keypair, made on first use. Two processes
   * starting together must end up with one key, so the first write wins
   * and everyone reads back whatever that was.
   */
  private async instanceKeys(): Promise<ActorKeyPair> {
    if (instanceKeysCache) return instanceKeysCache;
    let row = await this.prisma.serverSetting.findUnique({ where: { key: INSTANCE_KEYS_SETTING } });
    if (!row) {
      await this.prisma.serverSetting.createMany({
        data: [{ key: INSTANCE_KEYS_SETTING, value: JSON.stringify(generateActorKeyPair()) }],
        skipDuplicates: true,
      });
      row = await this.prisma.serverSetting.findUniqueOrThrow({ where: { key: INSTANCE_KEYS_SETTING } });
    }
    instanceKeysCache = JSON.parse(row.value) as ActorKeyPair;
    return instanceKeysCache;
  }

  /**
   * The installation as an actor — what Mastodon serves at `/actor`. It
   * exists so this server can sign what it fetches on its own account; a
   * server in authorized-fetch mode fetches it to check that signature.
   */
  async instanceActor() {
    if (!(await new SettingsService(this.prisma).isFederationEnabled())) {
      throw new AppError(404, "Federation is switched off on this server (Admin → Server settings).", "NOT_FOUND");
    }
    const base = config.federationBaseUrl;
    const id = instanceActorUriFor(base);
    const keys = await this.instanceKeys();
    return {
      "@context": AS_CONTEXT,
      id,
      type: "Application",
      // The host, as Mastodon names its own: WebFinger answers for
      // acct:<host>@<host>, and no username can contain a dot.
      preferredUsername: new URL(base).host,
      name: new URL(base).host,
      url: config.webOrigin,
      inbox: `${base}/federation/inbox`,
      outbox: `${id}/outbox`,
      endpoints: { sharedInbox: `${base}/federation/inbox` },
      manuallyApprovesFollowers: true,
      publicKey: { id: `${id}#main-key`, owner: id, publicKeyPem: keys.publicKeyPem },
    };
  }

  /** Signs a fetch this server makes on its own account, as the instance actor. */
  async fetchSigner(): Promise<RequestSigner> {
    const keys = await this.instanceKeys();
    return getRequestSigner(`${instanceActorUriFor(config.federationBaseUrl)}#main-key`, keys.privateKeyPem);
  }

  /** WebFinger: how `@alice@this.server` is resolved to an actor URL. */
  async webfinger(resource: string) {
    // acct:alice@host — the only scheme worth answering here.
    const match = resource.match(/^acct:([^@]+)@(.+)$/);
    if (!match) throw Errors.notFound("Account");

    const [, username, host] = match;
    const expectedHost = new URL(config.federationBaseUrl).host;
    // Answering for a host we are not would let this server vouch for
    // accounts elsewhere.
    if (host !== expectedHost) throw Errors.notFound("Account");

    // The instance actor, the way Mastodon's is found: acct:<host>@<host>.
    if (username === expectedHost) {
      const { id } = await this.instanceActor();
      return {
        subject: `acct:${expectedHost}@${expectedHost}`,
        aliases: [id],
        links: [{ rel: "self", type: "application/activity+json", href: id }],
      };
    }

    // Only for its 404: an account that does not federate is not found here.
    await this.requireFederatedCreator(username!);

    const actor = this.actorUri(username!);
    return {
      subject: `acct:${username}@${expectedHost}`,
      aliases: [actor],
      links: [
        { rel: "self", type: "application/activity+json", href: actor },
        { rel: "http://webfinger.net/rel/profile-page", type: "text/html", href: `${config.webOrigin}/${username}` },
      ],
    };
  }

  /** The actor document every remote server fetches before trusting anything. */
  async actor(username: string) {
    const found = await this.requireFederatedCreator(username);

    const keys = await this.ensureKeys(found.profile.id, found.settings);
    // Shared with the worker, which sends this same document inside an
    // Update when the profile changes.
    return buildPerson({
      base: config.federationBaseUrl,
      apiPublicUrl: config.apiPublicUrl,
      webOrigin: config.webOrigin,
      username,
      displayName: found.profile.displayName,
      bio: found.profile.bio,
      links: found.profile.links,
      avatarUrl: found.profile.avatarUrl,
      coverUrl: found.profile.coverUrl,
      publicKeyPem: keys.publicKeyPem,
      searchable: !found.profile.hideFromFediverseSearch,
    });
  }

  async followersCollection(username: string) {
    const found = await this.requireFederatedCreator(username);

    const total = await this.prisma.federationFollower.count({ where: { creatorId: found.profile.id } });
    const id = `${this.actorUri(username)}/followers`;
    // The collection is advertised without exposing who the followers
    // are — Mastodon does the same, and a follower list is not something
    // to hand to any anonymous fetcher.
    return { "@context": AS_CONTEXT[0], id, type: "OrderedCollection", totalItems: total };
  }

  /** Whom the author follows — nobody: this server follows no one. */
  async followingCollection(username: string) {
    await this.requireFederatedCreator(username);
    return {
      "@context": AS_CONTEXT[0],
      id: `${this.actorUri(username)}/following`,
      type: "OrderedCollection",
      totalItems: 0,
      orderedItems: [],
    };
  }

  /**
   * The author's pinned posts — Mastodon's "featured" collection, which it
   * reads for any profile, followed or not, and shows as pinned. Exactly
   * the posts pinned on this server, in the author's order; nothing is
   * pinned on the fediverse that the author did not pin here. Free posts
   * only, as everywhere federation reaches (`federatedPostWhere`).
   */
  async featuredCollection(username: string) {
    const found = await this.requireFederatedCreator(username);
    const posts = await this.prisma.digitalProduct.findMany({
      where: { ...federatedPostWhere(found.profile.id), featured: true },
      include: { post: { include: { attachments: true } } },
      orderBy: [{ featuredPosition: { sort: "asc", nulls: "last" } }, { publishedAt: "desc" }],
      take: FEATURED_POSTS,
    });

    return {
      "@context": AS_CONTEXT[0],
      id: featuredUriFor(config.federationBaseUrl, username),
      type: "OrderedCollection",
      totalItems: posts.length,
      orderedItems: posts.map((product) => this.noteFrom(product, username)),
    };
  }

  /**
   * Shaped like Mastodon's: the collection gives the count and names its
   * first page, and the posts are on the pages. Code that walks a
   * collection — Mastodon's among it — follows `first`; with the posts
   * inlined at the top instead, a Mastodon profile read the count ("3
   * posts") and showed none of them.
   */
  async outboxCollection(username: string) {
    const found = await this.requireFederatedCreator(username);
    const id = `${this.actorUri(username)}/outbox`;
    const totalItems = await this.prisma.digitalProduct.count({ where: federatedPostWhere(found.profile.id) });
    return {
      "@context": AS_CONTEXT[0],
      id,
      type: "OrderedCollection",
      totalItems,
      first: `${id}?page=true`,
    };
  }

  /** One page of the outbox, newest first; `before` is the cursor `next` hands out. */
  async outboxPage(username: string, before?: string) {
    const found = await this.requireFederatedCreator(username);
    const outbox = `${this.actorUri(username)}/outbox`;

    const cursor = before ? new Date(before) : null;
    if (cursor && Number.isNaN(cursor.getTime())) throw Errors.validation("That is not an outbox page.");

    const rows = await this.prisma.digitalProduct.findMany({
      where: { ...federatedPostWhere(found.profile.id), ...(cursor ? { publishedAt: { lt: cursor } } : {}) },
      include: { post: { include: { attachments: true } } },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: OUTBOX_PAGE + 1,
    });
    const posts = rows.slice(0, OUTBOX_PAGE);
    const oldest = posts[posts.length - 1];

    const actor = this.actorUri(username);
    return {
      "@context": AS_CONTEXT[0],
      id: cursor ? `${outbox}?page=true&before=${encodeURIComponent(before!)}` : `${outbox}?page=true`,
      type: "OrderedCollectionPage",
      partOf: outbox,
      ...(rows.length > OUTBOX_PAGE && oldest?.publishedAt
        ? { next: `${outbox}?page=true&before=${encodeURIComponent(oldest.publishedAt.toISOString())}` }
        : {}),
      orderedItems: posts.map((product) => {
        const note = this.noteFrom(product, username);
        return {
          id: `${note.id}#create`,
          type: "Create",
          actor,
          published: note.published,
          to: note.to,
          cc: note.cc,
          object: note,
        };
      }),
    };
  }

  /**
   * One post as a Note.
   *
   * `id` is a federation address that answers with this object — not the
   * page a person reads, which is `url`. A remote server dereferences the
   * id to ingest the post; pointed at the HTML page it gets markup where
   * it expects an object and drops the post without a word, which is why
   * a profile could federate and still look empty.
   */
  private noteFrom(
    product: {
      id: string;
      slug: string;
      title: string;
      description: string | null;
      publishedAt: Date | null;
      createdAt: Date;
      post?: { content: string; attachments?: { id: string; mimeType: string; altText: string | null; position: number }[] } | null;
    },
    username: string,
  ) {
    // Shared with the worker, which delivers the same Note to followers:
    // one post must look the same whichever way a server receives it.
    return buildNote({
      base: config.federationBaseUrl,
      apiPublicUrl: config.apiPublicUrl,
      webOrigin: config.webOrigin,
      username,
      post: {
        productId: product.id,
        slug: product.slug,
        title: product.title,
        description: product.description,
        content: product.post?.content ?? null,
        published: product.publishedAt ?? product.createdAt,
        attachments: product.post?.attachments ?? [],
      },
    });
  }

  /**
   * The same Note, found by the address a person reads it at. The post
   * page asks for this server-side to advertise its Note, so pasting a
   * post's link into Mastodon's search loads the post — the way to bring
   * in posts from before someone followed, which Mastodon never backfills.
   * Read-only on purpose: the store's own lookup counts a view.
   */
  async publicNoteBySlug(username: string, slug: string) {
    const product = await this.prisma.digitalProduct.findFirst({
      where: { ...(isPostId(slug) ? { id: slug } : { slug }), deletedAt: null, creator: { user: { username } } },
      select: { id: true },
    });
    if (!product) throw Errors.notFound("Post");
    return this.publicNote(product.id);
  }

  /** The Note behind `/federation/notes/:id`. Public posts only: anything
   * gated is not federated in the first place. */
  async publicNote(productId: string) {
    const product = await this.prisma.digitalProduct.findFirst({
      where: { id: productId, ...federatedPostWhere() },
      include: { post: { include: { attachments: true } }, creator: { include: { user: { select: { username: true } } } } },
    });
    if (!product) throw Errors.notFound("Post");

    const found = await this.findFederatedCreator(product.creator.user.username);
    if (!found) throw Errors.notFound("Post");

    return { "@context": AS_CONTEXT[0], ...this.noteFrom(product, product.creator.user.username) };
  }

  /**
   * Records a verified Follow and answers it with an Accept, which is
   * what actually makes the follow take effect on the remote side — a
   * Follow that is never accepted leaves the follower stuck "pending"
   * forever.
   */
  async acceptFollow(params: {
    username: string;
    followActivity: { id?: string; actor: string; object: unknown };
    remoteActor: { id: string; inbox: string; sharedInbox?: string | null; preferredUsername?: string | null };
  }) {
    const found = await this.requireFederatedCreator(params.username);

    // The inbox and sharedInbox are values *inside* a document a stranger
    // controls, not the URL we chose to fetch. Guarding the actor URL says
    // nothing about where it claims its inbox is, so a hostile but
    // publicly-resolvable actor could name a link-local or loopback
    // address and have this server POST a signed request to it. Checked
    // before anything is stored, so an unusable target never reaches the
    // database and cannot be delivered to later.
    // The operator's own limit, before anything is stored: a follower
    // this server will never deliver to is pure cost — a row, an Accept,
    // and a skipped target on every future post.
    if (!isFederationAllowed(params.remoteActor.id, await new SettingsService(this.prisma).federationPolicy())) {
      throw Errors.forbidden("This server does not federate with that instance.");
    }

    await this.guard(params.remoteActor.inbox);
    if (params.remoteActor.sharedInbox) {
      await this.guard(params.remoteActor.sharedInbox);
    }

    const domain = new URL(params.remoteActor.id).host;

    await this.prisma.federationFollower.upsert({
      where: { creatorId_actorUri: { creatorId: found.profile.id, actorUri: params.remoteActor.id } },
      update: {
        inbox: params.remoteActor.inbox,
        sharedInbox: params.remoteActor.sharedInbox ?? null,
        preferredUsername: params.remoteActor.preferredUsername ?? null,
      },
      create: {
        creatorId: found.profile.id,
        actorUri: params.remoteActor.id,
        inbox: params.remoteActor.inbox,
        sharedInbox: params.remoteActor.sharedInbox ?? null,
        preferredUsername: params.remoteActor.preferredUsername ?? null,
        domain,
      },
    });

    const keys = await this.ensureKeys(found.profile.id, found.settings);
    const actor = this.actorUri(params.username);
    const accept = {
      "@context": AS_CONTEXT[0],
      id: `${actor}#accepts/${encodeURIComponent(params.followActivity.id ?? params.remoteActor.id)}`,
      type: "Accept",
      actor,
      // Addressed to the follower, and carrying their Follow back with its
      // own type: implementations match the Accept to a pending follow by
      // the embedded activity, and some will not match one that arrives
      // without a type.
      to: [params.remoteActor.id],
      object: { type: "Follow", ...params.followActivity },
    };

    const body = JSON.stringify(accept);
    const headers = signRequest({
      keyId: `${actor}#main-key`,
      privateKeyPem: keys.privateKeyPem,
      method: "POST",
      targetUrl: params.remoteActor.inbox,
      body,
    });

    // Re-checked on every hop, so a redirect cannot walk this signed
    // delivery somewhere the initial check would have refused.
    //
    // The follow is recorded either way — a remote inbox that is briefly
    // down should not lose the follower, and their server re-sends the
    // Follow when it never sees an Accept. What is *not* acceptable is
    // dropping the outcome silently: a rejected Accept leaves the follow
    // pending forever on the other side, and with nothing logged there is
    // no way to tell that from a follow that simply never arrived.
    try {
      const res = await safeFetch(params.remoteActor.inbox, { method: "POST", headers, body }, this.guard);
      if (!res.ok) {
        this.log?.warn(
          { inbox: params.remoteActor.inbox, status: res.status, body: (await res.text().catch(() => "")).slice(0, 300) },
          "follower's server refused the Accept",
        );
      } else {
        this.log?.info({ inbox: params.remoteActor.inbox, status: res.status }, "sent Accept for a new follower");
      }
    } catch (err) {
      this.log?.warn(
        { inbox: params.remoteActor.inbox, err: err instanceof Error ? err.message : String(err) },
        "could not deliver the Accept",
      );
    }

    // A new follower gets the author's recent posts, not just future ones.
    await this.enqueueBackfill(found.profile.id, params.remoteActor.sharedInbox ?? params.remoteActor.inbox);
  }

  /**
   * Sends a new follower's server the author's recent public posts.
   *
   * Mastodon never backfills a remote account's history: a profile shows
   * only what has been delivered to that server, so an author with posts
   * looked empty ("Posts: 1", "No posts here") until the next one they
   * wrote. Delivering the recent ones on follow is what Sharkey and others
   * do, and Mastodon files them at their original dates rather than on top
   * of the timeline.
   *
   * Held back briefly: Mastodon accepts a post only from an account one of
   * its users follows, and it turns the pending request into a follow only
   * once it has processed the Accept sent just above. Arriving first, the
   * posts would be dropped. Already-delivered posts are skipped by the
   * unique (post, inbox) constraint, so a re-follow does not repeat them.
   */
  private async enqueueBackfill(creatorId: string, inbox: string): Promise<number> {
    const recent = await this.prisma.digitalProduct.findMany({
      where: federatedPostWhere(creatorId),
      orderBy: { publishedAt: "desc" },
      take: BACKFILL_POSTS,
      select: { id: true },
    });
    if (recent.length === 0) return 0;

    const notBefore = new Date(Date.now() + BACKFILL_DELAY_MS);
    const ids = recent.map((post) => post.id);

    // A delivery that failed before — the follower's server refused it, or
    // the follow was not established yet — is exactly what a new Follow
    // should retry; left FAILED, the unique constraint below would skip it
    // for good and the post would never arrive.
    const retried = await this.prisma.followerDelivery.updateMany({
      where: { productId: { in: ids }, inbox, kind: "POST", status: "FAILED" },
      data: { status: "PENDING", retryCount: 0, lastError: null, nextAttemptAt: notBefore },
    });
    const created = await this.prisma.followerDelivery.createMany({
      data: ids.map((productId) => ({ productId, inbox, nextAttemptAt: notBefore })),
      skipDuplicates: true,
    });
    return retried.count + created.count;
  }

  async removeFollower(username: string, actorUri: string) {
    const found = await this.findFederatedCreator(username);
    if (!found) return;
    await this.prisma.federationFollower.deleteMany({
      where: { creatorId: found.profile.id, actorUri },
    });
  }

  /**
   * Every follower's delivery target, deduplicated by shared inbox.
   *
   * Re-checked here as well as before storage: a row written before the
   * guard existed, or a host that has since resolved to a private
   * address, must not become a delivery. A target that fails is dropped
   * rather than throwing, so one bad follower cannot stop a post reaching
   * everyone else.
   */
  /**
   * Queues a just-published post for everyone following its author.
   *
   * This is the part of federation a follower actually notices: without
   * it a follow from Mastodon was accepted and then nothing ever arrived,
   * because posts went only to instances on an administrator's allowlist.
   *
   * Public, free posts only — the same rule every other path out of this
   * server follows — and nothing at all while the server has federation
   * switched off. One row per inbox (shared where the follower has one),
   * so a server with many followers here is delivered to once. The
   * delivery itself is the worker's job; nothing here talks to a remote
   * server.
   */
  async enqueuePostForFollowers(creatorId: string, productId: string): Promise<number> {
    if (!(await new SettingsService(this.prisma).isFederationEnabled())) return 0;

    const product = await this.prisma.digitalProduct.findUnique({
      where: { id: productId },
      include: { prices: { where: { active: true } } },
    });
    if (!product || product.creatorId !== creatorId) return 0;
    if (product.type !== "POST" || product.status !== "PUBLISHED" || product.deletedAt) return 0;
    if (product.visibility !== "PUBLIC") return 0;
    if (product.prices.some((price) => price.pricingType !== "FREE")) return 0;

    // Only the operator's domain policy here, not the address guard:
    // guarding means a DNS lookup per inbox, on the request that publishes
    // the post. The worker guards every address at the moment it sends —
    // which is the check that matters, since DNS can change in between.
    const followers = await this.prisma.federationFollower.findMany({
      where: { creatorId },
      select: { inbox: true, sharedInbox: true },
    });
    const policy = await new SettingsService(this.prisma).federationPolicy();
    const targets = [...new Set(followers.map((f) => f.sharedInbox ?? f.inbox))].filter((target) =>
      isFederationAllowed(target, policy),
    );
    if (targets.length === 0) return 0;

    const created = await this.prisma.followerDelivery.createMany({
      data: targets.map((inbox) => ({ productId, inbox })),
      // Publishing the same post twice (unpublish, publish again) must not
      // deliver it twice.
      skipDuplicates: true,
    });
    return created.count;
  }

  /**
   * Tells every follower's server that this author's profile changed —
   * avatar, header, name or bio — by queueing an `Update{Person}`.
   *
   * Without it a remote server keeps the profile it cached when it first
   * saw the author and refreshes only on its own schedule, which for
   * Mastodon means a new avatar shows up a day later at best. At most one
   * pending update per inbox: several edits in a row send the latest
   * profile once, since the worker builds it at send time.
   */
  /**
   * An edited post, to every follower's server: an `Update{Note}`, which is
   * the only way an edit reaches a server that already has the post — it
   * ignores a second Create. One pending row per post and inbox; editing
   * again before it goes out sends the latest version once, since the
   * worker builds the Note at send time.
   */
  async enqueuePostUpdateForFollowers(creatorId: string, productId: string): Promise<number> {
    if (!(await new SettingsService(this.prisma).isFederationEnabled())) return 0;
    const settings = await this.prisma.creatorFederationSettings.findUnique({ where: { creatorId } });
    if (!authorFederates(settings)) return 0;
    const post = await this.prisma.digitalProduct.findFirst({
      where: { id: productId, ...federatedPostWhere(creatorId) },
      select: { id: true },
    });
    if (!post) return 0;

    const followers = await this.prisma.federationFollower.findMany({
      where: { creatorId },
      select: { inbox: true, sharedInbox: true },
    });
    const policy = await new SettingsService(this.prisma).federationPolicy();
    const targets = [...new Set(followers.map((f) => f.sharedInbox ?? f.inbox))].filter((target) =>
      isFederationAllowed(target, policy),
    );
    for (const inbox of targets) {
      await this.prisma.followerDelivery.upsert({
        where: { productId_inbox_kind: { productId, inbox, kind: "UPDATE" } },
        update: { status: "PENDING", retryCount: 0, lastError: null, deliveredAt: null, nextAttemptAt: new Date() },
        create: { productId, inbox, kind: "UPDATE" },
      });
    }
    return targets.length;
  }

  async enqueueProfileUpdate(creatorId: string): Promise<number> {
    if (!(await new SettingsService(this.prisma).isFederationEnabled())) return 0;
    const settings = await this.prisma.creatorFederationSettings.findUnique({ where: { creatorId } });
    if (!authorFederates(settings)) return 0;

    const followers = await this.prisma.federationFollower.findMany({
      where: { creatorId },
      select: { inbox: true, sharedInbox: true },
    });
    const policy = await new SettingsService(this.prisma).federationPolicy();
    const targets = [...new Set(followers.map((f) => f.sharedInbox ?? f.inbox))].filter((target) =>
      isFederationAllowed(target, policy),
    );
    if (targets.length === 0) return 0;

    const alreadyQueued = new Set(
      (
        await this.prisma.followerDelivery.findMany({
          where: { creatorId, kind: "PROFILE", status: "PENDING", inbox: { in: targets } },
          select: { inbox: true },
        })
      ).map((row) => row.inbox),
    );
    const fresh = targets.filter((inbox) => !alreadyQueued.has(inbox));
    if (fresh.length === 0) return 0;

    const created = await this.prisma.followerDelivery.createMany({
      data: fresh.map((inbox) => ({ kind: "PROFILE" as const, creatorId, inbox })),
    });
    return created.count;
  }

  async deliveryTargets(creatorId: string): Promise<string[]> {
    const followers = await this.prisma.federationFollower.findMany({
      where: { creatorId },
      select: { inbox: true, sharedInbox: true },
    });

    // Re-checked rather than trusted from storage, so tightening the
    // policy takes effect on followers already recorded without needing a
    // migration or a cleanup job.
    const policy = await new SettingsService(this.prisma).federationPolicy();
    const candidates = [...new Set(followers.map((f) => f.sharedInbox ?? f.inbox))].filter((target) =>
      isFederationAllowed(target, policy),
    );
    const checked = await Promise.all(
      candidates.map(async (target) => {
        try {
          await this.guard(target);
          return target;
        } catch {
          return null;
        }
      }),
    );
    return checked.filter((target): target is string => target !== null);
  }
}
