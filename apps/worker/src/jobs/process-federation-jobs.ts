import { prisma } from "@platform/db";
import { ActivityPubProvider, FederationProviderError, type FederationProvider, type PublicPostPayload } from "@platform/integrations";
import { actorUriFor, federationBaseFrom, noteIdFor, postToActivityHtml, postPathFor } from "@platform/shared";

const MAX_RETRIES = 5;
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";
// The same origin the API serves federation from, and the same helpers it
// builds its URLs with. This job used to invent `WEB_ORIGIN/@username` as
// the actor, an address nothing serves: the receiving server could not
// fetch the key the delivery was signed with, so every post was rejected.
const FEDERATION_BASE = federationBaseFrom(process.env.API_PUBLIC_URL ?? WEB_ORIGIN);
const API_PUBLIC_URL = (process.env.API_PUBLIC_URL ?? WEB_ORIGIN).replace(/\/$/, "");

function backoffMinutes(retryCount: number): number {
  return Math.min(2 ** retryCount, 60);
}

type PendingFederatedPost = Awaited<ReturnType<typeof prisma.federatedPost.findMany>>[number] & {
  instance: NonNullable<Awaited<ReturnType<typeof prisma.federationInstance.findUnique>>>;
};

type ResolveProvider = (instance: PendingFederatedPost["instance"], actorId: string, privateKeyPem: string) => FederationProvider;

function defaultResolveProvider(instance: PendingFederatedPost["instance"], actorId: string, privateKeyPem: string): FederationProvider {
  return new ActivityPubProvider(instance.domain, actorId, privateKeyPem);
}

async function processOne(job: PendingFederatedPost, resolveProvider: ResolveProvider): Promise<void> {
  if (job.instance.status !== "APPROVED") {
    await prisma.federatedPost.update({
      where: { id: job.id },
      data: { status: "FAILED", error: "This instance has not been approved by platform moderation yet." },
    });
    return;
  }

  const product = await prisma.digitalProduct.findUnique({
    where: { id: job.postId },
    include: { post: { include: { attachments: true } }, creator: { include: { user: true } } },
  });
  if (!product?.post) {
    await prisma.federatedPost.update({ where: { id: job.id }, data: { status: "FAILED", error: "Source post no longer exists." } });
    return;
  }

  const settings = await prisma.creatorFederationSettings.findUnique({ where: { creatorId: product.creatorId } });
  if (!settings?.actorPrivateKeyPem) {
    await prisma.federatedPost.update({ where: { id: job.id }, data: { status: "FAILED", error: "No federation actor key configured." } });
    return;
  }

  const username = product.creator.user.username;
  const actorId = actorUriFor(FEDERATION_BASE, username);
  const postUrl = `${WEB_ORIGIN}${postPathFor(username, product.id)}`;
  const payload: PublicPostPayload = {
    id: product.id,
    // The address the Note itself answers at, which is what a remote
    // server dereferences — `url` is the page a person reads.
    objectId: noteIdFor(FEDERATION_BASE, product.id),
    actor: { id: actorId, preferredUsername: username, publicKeyPem: settings.actorPublicKeyPem ?? "" },
    // Converted here, once: the wire format is HTML.
    content: postToActivityHtml({ title: product.title, body: product.post.content }),
    url: postUrl,
    published: (product.publishedAt ?? product.createdAt).toISOString(),
    // Same URLs the outbox publishes; the download route re-checks access
    // on every request, and a federated post is public by definition.
    attachments: [...product.post.attachments]
      .sort((a, b) => a.position - b.position)
      .map((a) => ({
        url: `${API_PUBLIC_URL}/products/${product.id}/attachments/${a.id}/file`,
        mediaType: a.mimeType,
        ...(a.altText ? { alt: a.altText } : {}),
      })),
  };

  try {
    const provider = resolveProvider(job.instance, actorId, settings.actorPrivateKeyPem);
    const result = await provider.publishPost(payload);
    await prisma.federatedPost.update({
      where: { id: job.id },
      data: {
        status: "PUBLISHED",
        remoteActor: actorId,
        remotePostId: result.remotePostId,
        remoteUrl: result.remoteUrl,
        publishedAt: new Date(),
        lastSyncedAt: new Date(),
        error: null,
        nextAttemptAt: null,
      },
    });
  } catch (err) {
    const retryable = err instanceof FederationProviderError ? err.retryable : true;
    const message = err instanceof Error ? err.message : "Federation delivery failed.";
    const retryCount = job.retryCount + 1;

    if (!retryable || retryCount >= MAX_RETRIES) {
      await prisma.federatedPost.update({
        where: { id: job.id },
        data: { status: "FAILED", error: message, retryCount },
      });
    } else {
      await prisma.federatedPost.update({
        where: { id: job.id },
        data: {
          status: "PENDING",
          error: message,
          retryCount,
          nextAttemptAt: new Date(Date.now() + backoffMinutes(retryCount) * 60_000),
        },
      });
    }
  }
}

/**
 * Processes queued federation deliveries (spec rule #71) with retry +
 * exponential backoff + a dead-letter terminal state — never run inline
 * from a request. Only APPROVED instances (spec rule #68's platform-level
 * counterpart to the creator's own allowlist) are actually attempted.
 *
 * Due jobs are independent deliveries to (usually) different instances, so
 * they run concurrently via `Promise.allSettled` rather than a sequential
 * loop — one slow/unresponsive instance no longer blocks the rest of the
 * batch from draining within the same tick.
 */
export async function processFederationJobs(resolveProvider: ResolveProvider = defaultResolveProvider): Promise<number> {
  const due = await prisma.federatedPost.findMany({
    where: {
      status: "PENDING",
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    include: { instance: true },
    take: 10,
    orderBy: { createdAt: "asc" },
  });

  await Promise.allSettled(due.map((job) => processOne(job, resolveProvider)));

  return due.length;
}
