/**
 * The one place Cryptovich's version is written. The API and worker print it
 * when they start, NodeInfo reports it to other servers, and the web app
 * shows it under the navigation — so an operator can tell which build is
 * running without reading the image tags. `version.test.ts` keeps it equal
 * to the root package.json.
 */
export const APP_VERSION = "0.6.0";
export const APP_NAME = "Cryptovich";
/** The name where only lower-case letters do: NodeInfo's software name, error-report releases, a user agent. */
export const APP_SLUG = "cryptovich";

/**
 * The version to show: `APP_VERSION` from the environment when the
 * operator set one (a fork, a build tag, "0.2.0-mysite") — read at run
 * time, so changing it in `.env` needs a restart, not a rebuild — then the
 * version on CHANGELOG.md's first line (passed in by `runningVersion` in
 * `@platform/shared/node`, which reads the file), and the built-in one
 * otherwise. Server-side only: a browser has no environment, so the web
 * app is handed this value by its server-rendered layout.
 */
export function appVersion(
  env: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env,
  fromChangelog: string | null = null,
): string {
  // Kept to what fits under a menu, and to plain characters: this lands in
  // logs, in NodeInfo other servers read, and on every page.
  const usable = (value: string | null | undefined) => {
    const trimmed = value?.trim();
    return trimmed && /^[\w.+-]{1,40}$/.test(trimmed) ? trimmed : null;
  };
  return usable(env.APP_VERSION) ?? usable(fromChangelog) ?? APP_VERSION;
}
