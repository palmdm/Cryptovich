import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Server-side only: the usage policy is `policy.md` at the repository
 * root, written by the operator the way CHANGELOG.md is. There is no
 * policy until that file exists — no page, no link.
 *
 * Found at POLICY_FILE when that is set, otherwise by walking up from the
 * working directory: the repository root in development, /repo in the
 * image (the web Dockerfile copies it in its last layer).
 */
export function policyPath(env: Record<string, string | undefined> = process.env): string | null {
  if (env.POLICY_FILE) return existsSync(env.POLICY_FILE) ? env.POLICY_FILE : null;
  let dir = resolve(process.cwd());
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "policy.md");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export interface Policy {
  /** The file's opening `# heading`, which the page shows as its title. */
  title: string | null;
  /** Everything after it, rendered like a post body. */
  body: string;
}

/** Splits off a leading `# heading` so the page does not show it twice. */
export function parsePolicy(text: string): Policy | null {
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const first = lines.findIndex((line) => line.trim() !== "");
  if (first === -1) return null;
  const heading = lines[first]!.match(/^#\s+(.+?)\s*#*\s*$/);
  if (!heading) return { title: null, body: lines.slice(first).join("\n").trimEnd() };
  return { title: heading[1]!, body: lines.slice(first + 1).join("\n").trim() };
}

let cached: { path: string; mtimeMs: number; policy: Policy | null } | null = null;

/**
 * Re-read only when the file changed, so `pnpm dev` shows an edit at once;
 * in the image the file changes only with a rebuild.
 */
export function readPolicy(env: Record<string, string | undefined> = process.env): Policy | null {
  const path = policyPath(env);
  if (!path) return null;
  try {
    const { mtimeMs } = statSync(path);
    if (cached?.path !== path || cached.mtimeMs !== mtimeMs) {
      cached = { path, mtimeMs, policy: parsePolicy(readFileSync(path, "utf8")) };
    }
    return cached.policy;
  } catch {
    return null;
  }
}
