import { prisma } from "@platform/db";
import { assertPublicHttpUrl, safeFetch, signRequest } from "@platform/integrations";
import { actorUriFor, authorFederates, buildNote, buildPerson, federationBaseFrom } from "@platform/shared";

/**
 * Delivers queued posts to the inboxes of an author's followers.
 *
 * The API queues a row per follower inbox when a public, free post is
 * published (`ActivityPubService.enqueuePostForFollowers`); this sends
 * each one as a signed `Create{Note}` — the activity a Mastodon timeline
 * is actually built from. Before this existed, a follow from another
 * server was accepted and then nothing ever arrived.
 *
 * Retries back off exponentially. A 4xx other than 408/429 is final: the
 * receiving server has read the request and said no, and asking again
 * will not change its answer.
 */

const MAX_RETRIES = 8;
const BATCH = 25;

const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const API_PUBLIC_URL = (process.env.API_PUBLIC_URL ?? WEB_ORIGIN).replace(/\/$/, "");
const FEDERATION_BASE = federationBaseFrom(API_PUBLIC_URL);

function backoffMinutes(retryCount: number): number {
  return Math.min(2 ** retryCount, 360);
}

/** The fetch this uses, injectable so tests can stand in for the remote server. */
export type Fetcher = typeof safeFetch;

export async function deliverToFollowers(
  options: { fetcher?: Fetcher; guard?: (url: string) => Promise<void> } = {},
): Promise<number> {
  const fetcher = options.fetcher ?? safeFetch;
  const guard = options.guard ?? assertPublicHttpUrl;

  const due = await dueDeliveries();

  let handled = 0;
  for (const delivery of due) {
    const built =
      delivery.kind === "PROFILE" ? profileUpdate(delivery) : postActivity(delivery, delivery.kind === "UPDATE" ? "Update" : "Create");
    const what =
      delivery.kind === "PROFILE" ? "profile" : `${delivery.kind === "UPDATE" ? "edit of post" : "post"} ${delivery.productId}`;
    if ("skip" in built) {
      await prisma.followerDelivery.update({
        where: { id: delivery.id },
        data: { status: "FAILED", lastError: built.skip },
      });
      console.log(`[federation] ${what} → ${delivery.inbox}: skipped (${built.skip})`);
      handled += 1;
      continue;
    }

    const { activity, actor, privateKeyPem } = built;
    const body = JSON.stringify(activity);

    try {
      const headers = signRequest({
        keyId: `${actor}#main-key`,
        privateKeyPem,
        method: "POST",
        targetUrl: delivery.inbox,
        body,
      });
      const res = await fetcher(delivery.inbox, { method: "POST", headers, body }, guard);

      // One line per delivery: a follower who sees nothing is otherwise a
      // mystery, and the receiving server's status says which side to fix.
      if (res.ok) {
        await prisma.followerDelivery.update({
          where: { id: delivery.id },
          data: { status: "DELIVERED", deliveredAt: new Date(), lastError: null },
        });
        console.log(`[federation] ${what} → ${delivery.inbox}: accepted (HTTP ${res.status})`);
      } else {
        const final = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
        const outcome = await fail(delivery.id, delivery.retryCount, `HTTP ${res.status}`, final);
        console.warn(`[federation] ${what} → ${delivery.inbox}: refused (HTTP ${res.status}), ${outcome}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const outcome = await fail(delivery.id, delivery.retryCount, message, false);
      console.warn(`[federation] ${what} → ${delivery.inbox}: ${message}, ${outcome}`);
    }
    handled += 1;
  }

  return handled;
}

type Due = Awaited<ReturnType<typeof dueDeliveries>>[number];
type Built = { activity: object; actor: string; privateKeyPem: string } | { skip: string };

/** Everything due to be sent now, oldest first, with what it takes to build it. */
function dueDeliveries() {
  return prisma.followerDelivery.findMany({
    where: {
      status: "PENDING",
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    orderBy: { createdAt: "asc" },
    take: BATCH,
    include: {
      product: {
        include: {
          post: { include: { attachments: true } },
          prices: { where: { active: true } },
          creator: { include: { user: { select: { username: true } }, federationSettings: true } },
        },
      },
      creator: { include: { user: { select: { username: true } }, federationSettings: true } },
    },
  });
}

/**
 * The author's current profile as an `Update{Person}` — built now, at send
 * time, so a run of edits delivers the latest one rather than a stale copy.
 */
function profileUpdate(delivery: Due): Built {
  const creator = delivery.creator;
  const settings = creator?.federationSettings;
  if (!creator || !authorFederates(settings) || !settings?.actorPrivateKeyPem || !settings.actorPublicKeyPem) {
    return { skip: "No longer federated: the author's federation was switched off since it was queued." };
  }

  const username = creator.user.username;
  const person = buildPerson({
    base: FEDERATION_BASE,
    apiPublicUrl: API_PUBLIC_URL,
    webOrigin: WEB_ORIGIN,
    username,
    displayName: creator.displayName,
    bio: creator.bio,
    links: creator.links,
    avatarUrl: creator.avatarUrl,
    coverUrl: creator.coverUrl,
    publicKeyPem: settings.actorPublicKeyPem,
    searchable: !creator.hideFromFediverseSearch,
  });

  return {
    actor: person.id,
    privateKeyPem: settings.actorPrivateKeyPem,
    activity: {
      "@context": person["@context"],
      id: `${person.id}#updates/${delivery.id}`,
      type: "Update",
      actor: person.id,
      to: ["https://www.w3.org/ns/activitystreams#Public"],
      object: person,
    },
  };
}

/**
 * A post as a `Create{Note}` — or, for an edit, an `Update{Note}` whose
 * Note carries `updated`, which is what makes Mastodon apply it as an edit
 * of the post it already has rather than ignore it.
 */
function postActivity(delivery: Due, type: "Create" | "Update"): Built {
  const product = delivery.product;
  if (!product) return { skip: "The post no longer exists." };
  const settings = product.creator.federationSettings;

  // Re-checked at send time, not trusted from when it was queued: a post
  // made paid or private, deleted, or an author whose federation was
  // switched off in the meantime must not go out after all.
  const stillPublic =
    product.status === "PUBLISHED" &&
    !product.deletedAt &&
    product.visibility === "PUBLIC" &&
    product.prices.every((price) => price.pricingType === "FREE");
  if (!stillPublic || !authorFederates(settings) || !settings?.actorPrivateKeyPem) {
    return { skip: "No longer federated: the post or the author changed since it was queued." };
  }

  const username = product.creator.user.username;
  const actor = actorUriFor(FEDERATION_BASE, username);
  const note = buildNote({
    base: FEDERATION_BASE,
    apiPublicUrl: API_PUBLIC_URL,
    webOrigin: WEB_ORIGIN,
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

  if (type === "Update") {
    const updated = new Date().toISOString();
    return {
      actor,
      privateKeyPem: settings.actorPrivateKeyPem,
      activity: {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: `${note.id}#updates/${Date.parse(updated)}`,
        type: "Update",
        actor,
        published: updated,
        to: note.to,
        cc: note.cc,
        object: { ...note, updated },
      },
    };
  }

  return {
    actor,
    privateKeyPem: settings.actorPrivateKeyPem,
    activity: {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `${note.id}#create`,
      type: "Create",
      actor,
      published: note.published,
      to: note.to,
      cc: note.cc,
      object: note,
    },
  };
}

/** Records a failed attempt; returns what happens next, for the log. */
async function fail(id: string, retryCount: number, error: string, final: boolean): Promise<string> {
  const next = retryCount + 1;
  if (final || next >= MAX_RETRIES) {
    await prisma.followerDelivery.update({
      where: { id },
      data: { status: "FAILED", retryCount: next, lastError: error },
    });
    return "given up";
  }
  const minutes = backoffMinutes(next);
  await prisma.followerDelivery.update({
    where: { id },
    data: {
      retryCount: next,
      lastError: error,
      nextAttemptAt: new Date(Date.now() + minutes * 60_000),
    },
  });
  return `retrying in ${minutes} min`;
}
