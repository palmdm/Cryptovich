import { postPathFor } from "./post-links.js";
import { markdownToActivityHtml, postToActivityHtml } from "./post-html.js";
import { isSafeHttpUrl } from "./safe-url.js";

/**
 * The federation URLs, in one place because three processes build them.
 *
 * They have to agree exactly. A delivered activity is signed with
 * `<actor>#main-key`, and the receiving server fetches that actor to read
 * the key: name the actor anything the server does not actually serve —
 * `https://example.com/@alice` rather than the real actor document — and
 * every delivery is rejected, with nothing wrong visible on this side.
 * That is what the worker did, while the API served actors at a different
 * address entirely.
 */

/**
 * The origin federation lives at. WebFinger is looked up at the root of
 * the domain, and an inbound signature covers the path it was sent to, so
 * federation paths sit at the origin even when the API itself is served
 * under a prefix (`https://example.com/api`).
 */
export function federationBaseFrom(apiPublicUrl: string): string {
  return new URL(apiPublicUrl).origin;
}

export function actorUriFor(base: string, username: string): string {
  return `${base}/federation/users/${username}`;
}

/** An author's pinned posts, as Mastodon's `featured` collection. */
export function featuredUriFor(base: string, username: string): string {
  return `${actorUriFor(base, username)}/collections/featured`;
}

/**
 * This server's own actor — not a person, the installation. Its key signs
 * what the server fetches on its own account (a follower's actor and key,
 * before anyone here has anything to say to them), the way Mastodon's
 * `/actor` does. Servers in authorized-fetch mode refuse unsigned reads.
 */
/** The `ServerSetting` row holding the instance actor's keypair. */
export const INSTANCE_ACTOR_KEYS_SETTING = "instanceActorKeys";

/** The `ServerSetting` row holding the Web Push (VAPID) keypair. */
export const WEB_PUSH_VAPID_SETTING = "webPushVapidKeys";

export function instanceActorUriFor(base: string): string {
  return `${base}/federation/actor`;
}

/**
 * The ActivityPub id of a post — an address that answers with the Note
 * itself, not the HTML page.
 *
 * A remote server dereferences this id to ingest the post. Pointing it at
 * the human page means the server fetches a page of markup where it
 * expects an object, and the post silently never appears — the profile
 * shows up and looks empty. `url` is where the page goes instead.
 */
export function noteIdFor(base: string, productId: string): string {
  return `${base}/federation/notes/${productId}`;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * A post body as the fediverse expects it: HTML paragraphs.
 *
 * Mastodon and the rest render `content` as HTML, so plain text arrives
 * as one unbroken block with its line breaks gone. Everything is escaped
 * first — the body is an author's own text, and it must not be able to
 * inject markup into someone else's timeline.
 */
export function textToActivityHtml(text: string): string {
  const escaped = text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
  const paragraphs = escaped
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${block.replace(/\n/g, "<br />")}</p>`);
  return paragraphs.join("") || "<p></p>";
}

/** What a Note is built from — plain data, so every process can build one. */
export interface NoteSource {
  productId: string;
  slug: string;
  title: string;
  description: string | null;
  /** The post body; null for a product with no text. */
  content: string | null;
  published: Date;
  attachments: { id: string; mimeType: string; altText: string | null; position: number; originalFilename?: string }[];
}

/**
 * A post as an ActivityPub Note.
 *
 * Built in one place because two processes hand it to other servers —
 * the API when a remote server fetches it, the worker when it delivers it
 * to a follower — and a server that receives the same post twice with two
 * different shapes treats them as two different posts.
 */
export function buildNote(params: {
  base: string;
  apiPublicUrl: string;
  webOrigin: string;
  username: string;
  post: NoteSource;
}) {
  const { base, apiPublicUrl, webOrigin, username, post } = params;
  const api = apiPublicUrl.replace(/\/$/, "");
  return {
    id: noteIdFor(base, post.productId),
    type: "Note" as const,
    attributedTo: actorUriFor(base, username),
    content: postToActivityHtml({ title: post.title, body: post.content ?? post.description }),
    published: post.published.toISOString(),
    url: `${webOrigin.replace(/\/$/, "")}${postPathFor(username, post.productId)}`,
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    cc: [`${actorUriFor(base, username)}/followers`],
    attachment: [...post.attachments]
      .sort((a, b) => a.position - b.position)
      .map((a) => ({
        type: "Document" as const,
        mediaType: a.mimeType,
        url: `${api}/products/${post.productId}/attachments/${a.id}/file`,
        // A picture's description, or a file's name — what Sharkey shows
        // on a file (Mastodon does not show files at all).
        ...(a.altText ? { name: a.altText } : !a.mimeType.startsWith("image/") && a.originalFilename ? { name: a.originalFilename } : {}),
      })),
  };
}

const IMAGE_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
};

/** An avatar or header as an `Image`: absolute, and typed — a remote
 * server downloads and caches it, and one it cannot read leaves the
 * default avatar showing. */
function imageObject(url: string, apiPublicUrl: string) {
  const absolute = url.startsWith("/") ? `${apiPublicUrl.replace(/\/$/, "")}${url}` : url;
  const extension = new URL(absolute).pathname.split(".").pop()?.toLowerCase() ?? "";
  return { type: "Image" as const, mediaType: IMAGE_TYPES[extension] ?? "image/jpeg", url: absolute };
}

/**
 * An author as an ActivityPub `Person`.
 *
 * Built in one place for the same reason as `buildNote`: the API serves
 * it when a server fetches the actor, and the worker sends it inside an
 * `Update` when the profile changes — which is how another server learns
 * about a new avatar without waiting to re-fetch on its own schedule. Two
 * different shapes would have a remote server overwrite the good one.
 */
export function buildPerson(params: {
  base: string;
  apiPublicUrl: string;
  webOrigin: string;
  username: string;
  displayName: string;
  bio: string | null;
  /** The author's links, as stored (`CreatorProfile.links`); anything malformed is dropped. */
  links?: unknown;
  avatarUrl: string | null;
  coverUrl: string | null;
  publicKeyPem: string;
  /**
   * False when the author keeps out of fediverse search
   * (CreatorProfile.hideFromFediverseSearch): Mastodon then leaves them out
   * of its search and suggestions.
   */
  searchable?: boolean;
}) {
  const id = actorUriFor(params.base, params.username);
  const searchable = params.searchable ?? true;
  const links = profileLinksFrom(params.links);
  return {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1",
      {
        toot: "http://joinmastodon.org/ns#",
        featured: { "@id": "toot:featured", "@type": "@id" },
        schema: "http://schema.org#",
        PropertyValue: "schema:PropertyValue",
        value: "schema:value",
        discoverable: "toot:discoverable",
        indexable: "toot:indexable",
      },
    ],
    id,
    type: "Person" as const,
    preferredUsername: params.username,
    name: params.displayName,
    // The description as HTML, like a post: it used to go out as raw text,
    // so its line breaks collapsed and its links were dead.
    summary: params.bio?.trim() ? markdownToActivityHtml(params.bio) : "",
    // The author's links, as the name/value fields Mastodon shows under a
    // profile. `rel="me"` lets Mastodon mark a link verified when the page
    // it points to links back to this profile.
    attachment: links.map((link) => ({
      type: "PropertyValue" as const,
      name: link.label,
      value: `<a href="${escapeAttribute(link.url)}" rel="me nofollow noopener noreferrer" target="_blank">${escapeAttribute(displayUrl(link.url))}</a>`,
    })),
    url: `${params.webOrigin.replace(/\/$/, "")}/${params.username}`,
    inbox: `${id}/inbox`,
    outbox: `${id}/outbox`,
    followers: `${id}/followers`,
    // Authors here follow nobody from this server yet, but the field being
    // absent is enough for some implementations to baulk.
    following: `${id}/following`,
    // Pinned posts, in Mastodon's terms. Mastodon never loads a remote
    // account's history — its profile shows only posts that reached it —
    // but it does fetch this collection whenever it (re)reads the actor,
    // follower or not. It is the one way posts appear there before anyone
    // follows.
    featured: featuredUriFor(params.base, params.username),
    // A shared inbox lets a server with many followers here receive one
    // delivery instead of one per follower.
    endpoints: { sharedInbox: `${params.base}/federation/inbox` },
    publicKey: { id: `${id}#main-key`, owner: id, publicKeyPem: params.publicKeyPem },
    // Mastodon's two switches: shown in its directory and suggestions, and
    // its posts searchable by their words.
    discoverable: searchable,
    indexable: searchable,
    ...(params.avatarUrl ? { icon: imageObject(params.avatarUrl, params.apiPublicUrl) } : {}),
    ...(params.coverUrl ? { image: imageObject(params.coverUrl, params.apiPublicUrl) } : {}),
  };
}

/**
 * Whether an author is federated, given their settings row — or none.
 *
 * No row means federated. An installation federates every author the way
 * Mastodon or Sharkey federate every account, and an administrator opts
 * an author *out*; making it opt-in meant a working profile disappeared
 * from the fediverse the moment a row was missing, with nothing saying why.
 */
export function authorFederates(settings: { enabled: boolean } | null | undefined): boolean {
  return settings ? settings.enabled : true;
}

/** Whether an author's new public posts go out without a manual push. */
export function authorAutoPublishes(settings: { enabled: boolean; autoPublish: boolean } | null | undefined): boolean {
  return authorFederates(settings) && (settings?.autoPublish ?? true);
}

export interface ProfileLink {
  label: string;
  url: string;
}

/**
 * An author's links from what is stored (JSON), keeping only well-formed
 * http(s) ones — the column predates validation of every write, and what
 * comes out of it goes into markup on other servers.
 */
export function profileLinksFrom(value: unknown): ProfileLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is ProfileLink =>
        !!item &&
        typeof item === "object" &&
        typeof (item as ProfileLink).label === "string" &&
        typeof (item as ProfileLink).url === "string" &&
        (item as ProfileLink).label.trim() !== "" &&
        isSafeHttpUrl((item as ProfileLink).url),
    )
    .slice(0, 10)
    .map((item) => ({ label: item.label.trim().slice(0, 40), url: item.url }));
}

/** An address the way Mastodon shows one: no scheme, no trailing slash. */
function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}
