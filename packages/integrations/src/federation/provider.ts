export interface ActorInfo {
  id: string;
  preferredUsername: string;
  publicKeyPem: string;
}

export interface PublicPostPayload {
  id: string;
  /**
   * The ActivityPub id of the Note — an address that answers with the
   * object. Distinct from `url`, the page a person reads: a remote server
   * dereferences the id, and one pointing at HTML makes the post vanish
   * on arrival without an error anywhere.
   */
  objectId: string;
  actor: ActorInfo;
  content: string;
  url: string;
  published: string; // ISO timestamp
  attachments?: Array<{ url: string; mediaType: string; alt?: string }>;
}

export interface MediaPayload {
  url: string;
  mediaType: string;
}

export interface PublishResult {
  remotePostId: string;
  remoteUrl: string;
}

/**
 * Every fediverse target (a specific Mastodon/Sharkey/ActivityPub
 * instance) is reached through this interface — business logic
 * (FederationService, the worker job) never constructs a raw HTTP request
 * itself (spec rules #65, #149).
 */
export interface FederationProvider {
  connect(): Promise<void>;
  verifyConnection(): Promise<boolean>;
  publishPost(post: PublicPostPayload): Promise<PublishResult>;
  updatePost(remotePostId: string, post: PublicPostPayload): Promise<void>;
  deletePost(remotePostId: string): Promise<void>;
  publishMedia(media: MediaPayload): Promise<{ remoteUrl: string }>;
  getActor(): Promise<ActorInfo>;
}

export class FederationProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean = true,
  ) {
    super(message);
  }
}
