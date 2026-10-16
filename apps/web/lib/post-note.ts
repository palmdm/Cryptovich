/** Asked server-side, over the internal network — never from the browser. */
const API_INTERNAL_URL = (process.env.API_INTERNAL_URL || "http://localhost:4000").replace(/\/$/, "");

/**
 * The ActivityPub Note behind a post page, for the page to advertise with
 * `<link rel="alternate" type="application/activity+json">` — which is what
 * lets a post pasted into Mastodon's search be brought in. `ref` is the
 * post's id or its older slug.
 */
export async function noteUri(username: string, ref: string): Promise<string | null> {
  try {
    // The dedicated lookup rather than the store's: the store counts a
    // view, and a page render is not somebody reading the post.
    const res = await fetch(
      `${API_INTERNAL_URL}/federation/notes/by-page/${encodeURIComponent(username)}/${encodeURIComponent(ref)}`,
      { headers: { Accept: "application/activity+json" }, next: { revalidate: 300 } },
    );
    // 404 is the ordinary case: a gated post, or an author this server
    // does not federate, has no Note to advertise.
    if (!res.ok) return null;
    const note = (await res.json()) as { id?: string };
    return typeof note.id === "string" ? note.id : null;
  } catch {
    return null;
  }
}
