/**
 * CHANGELOG.md at the repository root is where an operator keeps the
 * version and what changed in it, in one file:
 *
 *     VERSION=0.3.0
 *
 *     ## 0.3.0 — 2026-10-01
 *     - what changed …
 *
 * The first line is the version Cryptovich reports (under the menu, in the logs,
 * in NodeInfo) and the one a release announcement is made for; the section
 * headed with that version is the announcement's text. Parsing is kept
 * apart from reading the file so the browser bundle never touches `fs`.
 */
export interface ChangelogRelease {
  version: string;
  /** Whatever follows the version on its heading line, e.g. its date. */
  label: string;
  /** The section's Markdown, as the post editor writes it. */
  notes: string;
}

export interface Changelog {
  version: string | null;
  releases: ChangelogRelease[];
}

/** A version as it may be shown: short, and plain characters only. */
export const VERSION_PATTERN = /^[\w.+-]{1,40}$/;

const VERSION_LINE = /^VERSION\s*=\s*(\S+)\s*$/i;
const RELEASE_HEADING = /^##\s+v?([\w.+-]{1,40})(.*)$/;

export function parseChangelog(text: string): Changelog {
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const firstLine = lines.find((line) => line.trim() !== "")?.trim() ?? "";
  const declared = firstLine.match(VERSION_LINE)?.[1] ?? null;

  const releases: ChangelogRelease[] = [];
  let current: { version: string; label: string; body: string[] } | null = null;
  const close = () => {
    if (current) releases.push({ version: current.version, label: current.label, notes: current.body.join("\n").trim() });
  };
  for (const line of lines) {
    const heading = line.match(RELEASE_HEADING);
    if (heading) {
      close();
      current = { version: heading[1]!, label: heading[2]!.replace(/^[\s—–:-]+/, "").trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  close();

  return { version: declared && VERSION_PATTERN.test(declared) ? declared : null, releases };
}

/** The notes written for one version, or null when it has no section (or an empty one). */
export function releaseNotes(changelog: Changelog | null, version: string): string | null {
  return changelog?.releases.find((release) => release.version === version)?.notes || null;
}
