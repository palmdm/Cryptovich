import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  verifySignedRequest,
  fetchActorKey,
  safeFetch,
  SignatureVerificationError,
  type ActorResolver,
} from "@platform/integrations";
import { APP_SLUG } from "@platform/shared";
import { runningVersion } from "@platform/shared/node";
import { ActivityPubService } from "./service.js";
import { config } from "../../config.js";
import { Errors } from "../../lib/errors.js";

const ACTIVITY_JSON = "application/activity+json; charset=utf-8";

/** Where deliveries back to a remote actor go. */
export interface RemoteInbox {
  id: string;
  inbox: string;
  sharedInbox: string | null;
  preferredUsername: string | null;
}

export type InboxResolver = (actorUri: string) => Promise<RemoteInbox>;

/**
 * The endpoints other servers talk to. None of them take a session: a
 * remote instance has no account here, and its authority comes entirely
 * from the HTTP Signature on what it sends.
 *
 * These are mounted under a scope with a raw-body parser, because a
 * signature covers the exact bytes received — parsing to JSON first and
 * re-serialising would change them and every signature would fail.
 */
export default async function activityPubRoutes(
  app: FastifyInstance,
  /**
   * `resolveActor` defaults to a real fetch of the signer's actor
   * document. It is injectable for the same reason the feed providers'
   * SSRF guard is: a test that stubs the network still pays for a real
   * DNS lookup against a hostname that does not exist, and would be
   * asserting on the guard rather than on this module.
   */
  options: { resolveActor?: ActorResolver; resolveInbox?: InboxResolver; guard?: (url: string) => Promise<void> } = {},
) {
  const service = new ActivityPubService(app.prisma, options.guard, app.log);
  // Both fetches are signed as this server: a server in authorized-fetch
  // mode (mastodon.social, and many self-hosted Mastodons) answers 401 to
  // an unsigned read of even a public actor, and every Follow from it was
  // refused because the follower's key could not be read.
  const resolveActor: ActorResolver =
    options.resolveActor ?? (async (keyId) => fetchActorKey(keyId, options.guard, await service.fetchSigner()));
  const resolveInbox = options.resolveInbox ?? fetchInbox;

  // Every read another server makes here, and who made it: the user agent
  // names the software and version ("Mastodon/4.5.0 (...; +https://host/)"),
  // so "their server shows nothing" can be checked against what it
  // actually asked for, and what it was told.
  app.addHook("onResponse", async (request, reply) => {
    if (request.method !== "GET") return;
    request.log.info(
      { url: request.url, status: reply.statusCode, agent: request.headers["user-agent"] },
      "federation read",
    );
  });

  // WebFinger lives at a fixed well-known path; it is how `@alice@host`
  // becomes an actor URL in the first place.
  app.get("/.well-known/webfinger", async (request, reply) => {
    const { resource } = request.query as { resource?: string };
    if (!resource) throw Errors.validation("A resource is required.");
    const document = await service.webfinger(resource);
    reply.header("Content-Type", "application/jrd+json; charset=utf-8").send(document);
  });

  // A minimal NodeInfo pointer. Several implementations look for it to
  // decide what this server is before interacting with it.
  app.get("/.well-known/nodeinfo", async (_request, reply) => {
    reply.send({
      links: [{ rel: "http://nodeinfo.diaspora.software/ns/schema/2.1", href: `${config.federationBaseUrl}/nodeinfo/2.1` }],
    });
  });

  app.get("/nodeinfo/2.1", async (_request, reply) => {
    const [users, posts] = await Promise.all([
      app.prisma.creatorProfile.count(),
      app.prisma.digitalProduct.count({ where: { status: "PUBLISHED", visibility: "PUBLIC", deletedAt: null } }),
    ]);
    reply.send({
      version: "2.1",
      // NodeInfo allows only lower-case letters, digits and hyphens here.
      software: { name: APP_SLUG, version: runningVersion() },
      protocols: ["activitypub"],
      services: { inbound: [], outbound: [] },
      openRegistrations: false,
      usage: { users: { total: users }, localPosts: posts },
      metadata: {},
    });
  });

  app.get("/federation/actor", async (_request, reply) => {
    reply.header("Content-Type", ACTIVITY_JSON).send(await service.instanceActor());
  });

  // Named by the instance actor, and empty: it publishes nothing.
  app.get("/federation/actor/outbox", async (_request, reply) => {
    const { id } = await service.instanceActor();
    reply
      .header("Content-Type", ACTIVITY_JSON)
      .send({ "@context": "https://www.w3.org/ns/activitystreams", id: `${id}/outbox`, type: "OrderedCollection", totalItems: 0, orderedItems: [] });
  });

  app.get("/federation/users/:username", async (request, reply) => {
    const { username } = request.params as { username: string };
    reply.header("Content-Type", ACTIVITY_JSON).send(await service.actor(username));
  });

  // The object a remote server fetches when it ingests a post. Public by
  // necessity — federation is servers talking to each other, not signed-in
  // readers — and only ever serves a post that is already public.
  app.get("/federation/notes/by-page/:username/:slug", async (request, reply) => {
    const { username, slug } = request.params as { username: string; slug: string };
    reply.header("Content-Type", ACTIVITY_JSON).send(await service.publicNoteBySlug(username, slug));
  });

  app.get("/federation/notes/:productId", async (request, reply) => {
    const { productId } = request.params as { productId: string };
    reply.header("Content-Type", ACTIVITY_JSON).send(await service.publicNote(productId));
  });

  app.get("/federation/users/:username/followers", async (request, reply) => {
    const { username } = request.params as { username: string };
    reply.header("Content-Type", ACTIVITY_JSON).send(await service.followersCollection(username));
  });

  // Empty, but present: the actor names it, and an actor naming a
  // collection that 404s trips some implementations.
  app.get("/federation/users/:username/following", async (request, reply) => {
    const { username } = request.params as { username: string };
    reply.header("Content-Type", ACTIVITY_JSON).send(await service.followingCollection(username));
  });

  app.get("/federation/users/:username/collections/featured", async (request, reply) => {
    const { username } = request.params as { username: string };
    reply.header("Content-Type", ACTIVITY_JSON).send(await service.featuredCollection(username));
  });

  app.get("/federation/users/:username/outbox", async (request, reply) => {
    const { username } = request.params as { username: string };
    const { page, before } = request.query as { page?: string; before?: string };
    reply
      .header("Content-Type", ACTIVITY_JSON)
      .send(page ? await service.outboxPage(username, before) : await service.outboxCollection(username));
  });

  /**
   * Verifies the signature, then hands back the activity. A failure here
   * is always a dropped delivery — never a "process it anyway".
   */
  async function verified(request: FastifyRequest) {
    const rawBody = typeof request.body === "string" ? request.body : "";
    // The signature covers `host`, and every proxy in front of this server
    // rewrites it on the way in — the sender signed the public one.
    //
    // There is no single right answer to read back, which is why this
    // passes candidates: behind Cloudflare → nginx → the web server's own
    // proxy, `x-forwarded-host` can end up a chain whose *last* value (the
    // one Fastify reports) is the internal address, and verification then
    // fails for every legitimate delivery. The configured public host
    // comes first because it is the one this server actually answers to.
    //
    // The path is not rewritten: federation is proxied path-for-path,
    // which is what keeps `(request-target)` verifiable too.
    const forwardedHost = request.headers["x-forwarded-host"];
    const signer = await verifySignedRequest(
      {
        method: request.method,
        path: request.url,
        headers: request.headers as Record<string, string | string[] | undefined>,
        rawBody,
        hostCandidates: [
          new URL(config.federationBaseUrl).host,
          request.host,
          ...(Array.isArray(forwardedHost) ? forwardedHost : forwardedHost ? [forwardedHost] : []),
        ],
      },
      resolveActor,
    );

    let activity: { type?: string; id?: string; actor?: unknown; object?: unknown };
    try {
      activity = JSON.parse(rawBody);
    } catch {
      throw Errors.validation("Body is not valid JSON.");
    }

    const claimed = typeof activity.actor === "string" ? activity.actor : undefined;
    // The signature proves who sent the request; this proves the activity
    // is not attributed to somebody else. Both must agree, or a server
    // could sign with its own key while claiming to act for another actor.
    if (claimed && claimed !== signer.id) {
      throw new SignatureVerificationError("Activity actor does not match the signing key.");
    }

    request.log.info(
      { activity: activity.type, actor: signer.id, target: request.url },
      "accepted a signed inbox delivery",
    );
    return { activity, signerId: signer.id };
  }

  /** Fetches the sender's actor document to learn where to deliver back. */
  async function fetchInbox(actorUri: string): Promise<RemoteInbox> {
    // safeFetch guards every redirect hop, not just this URL.
    const res = await safeFetch(
      actorUri,
      { headers: { Accept: "application/activity+json, application/ld+json" }, sign: await service.fetchSigner() },
      options.guard,
    );
    if (!res.ok) throw Errors.validation(`Could not fetch the sending actor (HTTP ${res.status}).`);
    const actor = (await res.json()) as {
      id?: string;
      inbox?: string;
      preferredUsername?: string;
      endpoints?: { sharedInbox?: string };
    };
    if (!actor.id || !actor.inbox) throw Errors.validation("That actor has no inbox.");
    return {
      id: actor.id,
      inbox: actor.inbox,
      sharedInbox: actor.endpoints?.sharedInbox ?? null,
      preferredUsername: actor.preferredUsername ?? null,
    };
  }

  async function handleActivity(username: string | null, request: FastifyRequest) {
    const { activity, signerId } = await verified(request);

    switch (activity.type) {
      case "Follow": {
        // The object names which author is being followed; on the shared
        // inbox that is the only way to know.
        const object = typeof activity.object === "string" ? activity.object : undefined;
        const target = username ?? object?.split("/").pop();
        if (!target) throw Errors.validation("Follow has no target.");

        const remoteActor = await resolveInbox(signerId);
        try {
          await service.acceptFollow({
            username: target,
            followActivity: { id: activity.id, actor: signerId, object: activity.object },
            remoteActor,
          });
        } catch (err) {
          // An actor naming an address we refuse to reach is a rejected
          // delivery, not a fault on this side.
          if (err instanceof Error && /blocked|resolve|private|reserved/i.test(err.message)) {
            throw Errors.validation("That actor's inbox is not reachable.");
          }
          throw err;
        }
        return;
      }

      case "Undo": {
        const inner = activity.object as { type?: string; object?: unknown } | undefined;
        if (inner?.type === "Follow") {
          const object = typeof inner.object === "string" ? inner.object : undefined;
          const target = username ?? object?.split("/").pop();
          if (target) await service.removeFollower(target, signerId);
        }
        return;
      }

      case "Delete": {
        // A remote account going away takes its follow with it. Only the
        // actor's own deletion is acted on — a Delete for anything else is
        // about content this server does not store.
        if (typeof activity.object === "string" && activity.object === signerId) {
          await app.prisma.federationFollower.deleteMany({ where: { actorUri: signerId } });
        }
        return;
      }

      default:
        // Unknown activity types are accepted and ignored rather than
        // rejected: the network is many implementations wide and sends
        // plenty this server has no use for.
        return;
    }
  }

  app.post("/federation/users/:username/inbox", async (request, reply) => {
    const { username } = request.params as { username: string };
    try {
      await handleActivity(username, request);
    } catch (err) {
      if (err instanceof SignatureVerificationError) {
        request.log.warn({ err: err.message }, "rejected an unverified inbox delivery");
        return reply.code(401).send({ error: { code: "SIGNATURE_INVALID", message: err.message } });
      }
      // Anything else — the follower's actor could not be read, its inbox
      // is refused — is the other half of "the follow never went through",
      // and the remote server's own log is not one the operator can read.
      request.log.warn({ err: err instanceof Error ? err.message : String(err) }, "failed to handle an inbox delivery");
      throw err;
    }
    // 202: accepted for processing, which is what the spec asks for and
    // what remote servers expect.
    reply.code(202).send();
  });

  app.post("/federation/inbox", async (request, reply) => {
    try {
      await handleActivity(null, request);
    } catch (err) {
      if (err instanceof SignatureVerificationError) {
        request.log.warn({ err: err.message }, "rejected an unverified shared-inbox delivery");
        return reply.code(401).send({ error: { code: "SIGNATURE_INVALID", message: err.message } });
      }
      // Anything else — the follower's actor could not be read, its inbox
      // is refused — is the other half of "the follow never went through",
      // and the remote server's own log is not one the operator can read.
      request.log.warn({ err: err instanceof Error ? err.message : String(err) }, "failed to handle an shared-inbox delivery");
      throw err;
    }
    reply.code(202).send();
  });
}
