/**
 * A post's address, Boosty-style: `/<author>/posts/<post id>`.
 *
 * The id rather than a slug made from the title: it never changes when the
 * title does, it says nothing about a draft's title before it is out, and
 * it is the same id federation already names the Note by. Posts used to
 * live at `/<author>/p/<slug>`; those links keep working, and the page
 * moves the browser on to this one.
 */
export function postPathFor(username: string, productId: string): string {
  return `/${username}/posts/${productId}`;
}

const POST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a post reference in a URL is an id (the current form) rather than a slug. */
export function isPostId(ref: string): boolean {
  return POST_ID.test(ref);
}
