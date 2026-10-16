import type { PrismaClient } from "@platform/db";

/**
 * Resolves a username as it appears in a URL to the account's *current*
 * username — following a rename if the requested one is now historical.
 *
 * A live match always wins over history: if the requested name is
 * somebody's current username, that is who it means, never a different
 * account's old name (registration and renaming both refuse a name that
 * is reserved in UsernameHistory, so this ambiguity can't actually arise
 * — but resolving live-first keeps the function correct even if that
 * invariant is ever violated by hand, e.g. directly in the database).
 *
 * Returns null for a name that was never a real account, and for one
 * whose current owner has since deleted their account — an old link to a
 * deleted user should 404 like any other, not resurrect them.
 */
export async function resolveCurrentUsername(prisma: PrismaClient, requested: string): Promise<string | null> {
  const live = await prisma.user.findUnique({
    where: { username: requested },
    select: { username: true, deletedAt: true },
  });
  if (live) return live.deletedAt ? null : live.username;

  const historical = await prisma.usernameHistory.findUnique({
    where: { username: requested },
    select: { user: { select: { username: true, deletedAt: true } } },
  });
  if (historical && !historical.user.deletedAt) return historical.user.username;

  return null;
}

/**
 * Names a new account cannot take: its page would be `/<name>`, and the
 * site already has a page there, so the profile could never be opened.
 * These are the web app's top-level pages (`apps/web/app/*`) and the
 * paths the site hands to the API at its root. Only sign-up refuses them;
 * the bootstrap administrator is `admin` by default and keeps that name.
 * `test/reserved-usernames.test.ts` fails when a page is added to the web
 * app without its name here.
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  "admin",
  "bookmarks",
  "dashboard",
  "feed",
  "library",
  "link",
  "links",
  "login",
  "notifications",
  "policy",
  "register",
  "search",
  "settings",
  "subscriptions",
  // Proxied at the root (next.config.mjs), and Next's own files.
  "api",
  "status",
  "healthz",
  // Short links (/s/<code>).
  "s",
  "federation",
  "nodeinfo",
  "_next",
]);

/**
 * Whether `username` is free to become someone's username right now —
 * checked against both live accounts and history, so a new signup (or a
 * rename) can never claim a name that is reserved as somebody else's old
 * identity. `excludingUserId` lets a user reclaim a name from their own
 * history (reverting a rename) without the check tripping over their own
 * reservation of it.
 */
export async function isUsernameAvailable(
  prisma: PrismaClient,
  username: string,
  excludingUserId?: string,
): Promise<boolean> {
  const live = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (live && live.id !== excludingUserId) return false;

  const historical = await prisma.usernameHistory.findUnique({ where: { username }, select: { userId: true } });
  if (historical && historical.userId !== excludingUserId) return false;

  return true;
}
