import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { appVersion } from "./version.js";
import { parseChangelog, releaseNotes, type Changelog } from "./changelog.js";
import type { ErrorReporter } from "./error-reporting.js";

/**
 * Server-side only (`@platform/shared/node`): reads CHANGELOG.md, which the
 * browser bundle must never try to import.
 *
 * The file is found at CHANGELOG_FILE when that is set, otherwise by
 * walking up from the working directory — the repository root in
 * development (apps/api, apps/web) and /repo in every image.
 */
export function changelogPath(env: Record<string, string | undefined> = process.env): string | null {
  if (env.CHANGELOG_FILE) return existsSync(env.CHANGELOG_FILE) ? env.CHANGELOG_FILE : null;
  let dir = resolve(process.cwd());
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "CHANGELOG.md");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

let cached: { changelog: Changelog | null } | null = null;

/** Read once per process: like `.env`, an edit takes effect on restart. */
export function changelog(): Changelog | null {
  if (!cached) {
    const path = changelogPath();
    let parsed: Changelog | null = null;
    try {
      parsed = path ? parseChangelog(readFileSync(path, "utf8")) : null;
    } catch {
      parsed = null;
    }
    cached = { changelog: parsed };
  }
  return cached.changelog;
}

/**
 * The version this installation reports: APP_VERSION in `.env` when the
 * operator set one, else the first line of CHANGELOG.md, else the version
 * this build ships with.
 */
export function runningVersion(env: Record<string, string | undefined> = process.env): string {
  return appVersion(env, changelog()?.version ?? null);
}

/** The changelog's section for `version`, for its release announcement. */
export function notesFor(version: string): string | null {
  return releaseNotes(changelog(), version);
}

/**
 * A crash is reported before the process goes — with the same ending it
 * always had (exit 1, and the container restarts), only now someone hears
 * of it (when SENTRY_DSN is set).
 */
export function reportCrashes(reporter: ErrorReporter, service: string): void {
  const crash = async (error: unknown, kind: string) => {
    reporter.captureException(error, { tags: { kind } });
    await reporter.flush(2000);
    console.error(`[${service}] ${kind}`, error);
    process.exit(1);
  };
  process.on("uncaughtException", (error) => void crash(error, "uncaughtException"));
  process.on("unhandledRejection", (reason) => void crash(reason, "unhandledRejection"));
}
