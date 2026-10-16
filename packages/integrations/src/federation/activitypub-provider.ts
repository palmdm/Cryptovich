import type { FederationProvider, ActorInfo, PublicPostPayload, MediaPayload, PublishResult } from "./provider.js";
import { FederationProviderError } from "./provider.js";
import { signRequest } from "./signing.js";
import { safeFetch } from "../feed/safe-fetch.js";
import { assertPublicHttpUrl } from "../feed/ssrf-guard.js";

function toActivityStreamsNote(post: PublicPostPayload) {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: post.objectId,
    type: "Note",
    attributedTo: post.actor.id,
    // Already HTML: receiving servers render `content` as markup, and the
    // caller converts and escapes the author's text (postToActivityHtml).
    content: post.content,
    url: post.url,
    published: post.published,
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    attachment: (post.attachments ?? []).map((a) => ({ type: "Document", mediaType: a.mediaType, url: a.url, name: a.alt })),
  };
}

/**
 * Real outbound ActivityPub delivery: builds a spec-shaped
 * Create/Update/Delete activity and POSTs it, signed with HTTP
 * Signatures, to the target instance's shared inbox. This platform does
 * not yet serve actor/WebFinger documents for its own creators (see
 * docs/FEDERATION.md), so a receiving server that insists on
 * dereferencing the actor before trusting a signature will still reject
 * delivery — the signing and payload construction here are genuine, but
 * full interoperability needs that follow-up piece. Never exercised
 * against a real fediverse instance except by a creator who has
 * explicitly configured one (spec rule #68).
 */
export class ActivityPubProvider implements FederationProvider {
  private readonly instanceUrl: string;

  constructor(
    instanceDomainOrUrl: string,
    private readonly actorId: string,
    private readonly privateKeyPem: string,
    // The instance is the operator's choice, but its address is still only
    // reached through the SSRF guard: a typo or a hostile DNS answer must
    // not turn a delivery into a request to something internal.
    private readonly guard: (url: string) => Promise<void> = assertPublicHttpUrl,
  ) {
    this.instanceUrl = /^https?:\/\//.test(instanceDomainOrUrl)
      ? instanceDomainOrUrl.replace(/\/$/, "")
      : `https://${instanceDomainOrUrl.replace(/\/$/, "")}`;
  }

  private inboxUrl(): string {
    return `${this.instanceUrl}/inbox`;
  }

  private async deliver(activity: unknown): Promise<void> {
    const body = JSON.stringify(activity);
    const targetUrl = this.inboxUrl();
    const headers = signRequest({
      keyId: `${this.actorId}#main-key`,
      privateKeyPem: this.privateKeyPem,
      method: "POST",
      targetUrl,
      body,
    });

    let res: Response;
    try {
      res = await safeFetch(targetUrl, { method: "POST", headers, body }, this.guard);
    } catch (err) {
      throw new FederationProviderError(err instanceof Error ? err.message : "Network error delivering activity", true);
    }

    if (!res.ok) {
      const retryable = res.status >= 500 || res.status === 429;
      throw new FederationProviderError(`Instance responded ${res.status} to delivery`, retryable);
    }
  }

  async connect(): Promise<void> {
    // No handshake step in ActivityPub itself; verified per-delivery.
  }

  async verifyConnection(): Promise<boolean> {
    try {
      const res = await safeFetch(`${this.instanceUrl}/.well-known/nodeinfo`, { method: "GET" }, this.guard);
      return res.ok;
    } catch {
      return false;
    }
  }

  async publishPost(post: PublicPostPayload): Promise<PublishResult> {
    await this.deliver({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `${post.objectId}#create`,
      type: "Create",
      actor: post.actor.id,
      object: toActivityStreamsNote(post),
      to: ["https://www.w3.org/ns/activitystreams#Public"],
    });
    return { remotePostId: post.id, remoteUrl: post.url };
  }

  async updatePost(_remotePostId: string, post: PublicPostPayload): Promise<void> {
    await this.deliver({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `${post.objectId}#update-${Date.now()}`,
      type: "Update",
      actor: post.actor.id,
      object: toActivityStreamsNote(post),
      to: ["https://www.w3.org/ns/activitystreams#Public"],
    });
  }

  async deletePost(remotePostId: string): Promise<void> {
    await this.deliver({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `${remotePostId}#delete-${Date.now()}`,
      type: "Delete",
      object: { id: remotePostId, type: "Tombstone" },
    });
  }

  async publishMedia(media: MediaPayload): Promise<{ remoteUrl: string }> {
    // Media is referenced by URL in the Note's `attachment` field rather
    // than uploaded separately — the receiving instance fetches it.
    return { remoteUrl: media.url };
  }

  async getActor(): Promise<ActorInfo> {
    throw new FederationProviderError("Actor document is not exposed by this provider instance.", false);
  }
}
