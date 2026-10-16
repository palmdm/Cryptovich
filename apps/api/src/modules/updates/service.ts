import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Redis } from "ioredis";
import { safeFetch } from "@platform/integrations";
import { compareVersions, PROJECT_REPOSITORY, releaseAssetNames } from "@platform/shared";
import { runningVersion } from "@platform/shared/node";
import { Errors } from "../../lib/errors.js";

export interface LatestRelease {
  version: string;
  url: string;
  publishedAt: string | null;
  notes: string | null;
  zipUrl: string | null;
  signatureUrl: string | null;
}

/** What the updater says about itself (deploy/updater writes it every few seconds). */
interface UpdaterHeartbeat {
  at: string;
  hasKey: boolean;
  version: string;
}

const CACHE_KEY = "updates:latest";
const CACHE_SECONDS = 60 * 60;
const RELEASE_DOWNLOADS = `https://github.com/${PROJECT_REPOSITORY}/releases/download/`;

type Fetcher = (url: string) => Promise<Response>;

/**
 * Checking for a newer Cryptovich, and asking the updater to install it.
 *
 * The check reads the project's latest GitHub release (cached for an
 * hour). Installing is the updater's job (deploy/updater, beside the
 * gate): this only leaves it a request in the folder they share — the
 * API has no Docker and no say over what runs. The updater installs only a
 * release signed with the key the installed version carries, and only a
 * newer one, so a request is all a compromised API could ever write.
 */
export class UpdateService {
  constructor(
    private readonly redis: Redis,
    private readonly dir: string | undefined = process.env.UPDATES_DIR,
    private readonly fetcher: Fetcher = (url) =>
      safeFetch(url, { timeoutMs: 10_000, headers: { accept: "application/vnd.github+json", "user-agent": "cryptovich-update-check" } }),
  ) {}

  async latest(refresh = false): Promise<{ release: LatestRelease | null; checkedAt: string; error: string | null }> {
    if (!refresh) {
      const cached = await this.redis.get(CACHE_KEY);
      if (cached) return JSON.parse(cached);
    }
    let result: { release: LatestRelease | null; checkedAt: string; error: string | null };
    try {
      const res = await this.fetcher(`https://api.github.com/repos/${PROJECT_REPOSITORY}/releases/latest`);
      if (res.status === 404) {
        result = { release: null, checkedAt: new Date().toISOString(), error: "NO_RELEASES" };
      } else if (!res.ok) {
        result = { release: null, checkedAt: new Date().toISOString(), error: "UNAVAILABLE" };
      } else {
        const body = (await res.json()) as {
          tag_name?: string;
          html_url?: string;
          published_at?: string;
          body?: string;
          assets?: { name: string; browser_download_url: string }[];
        };
        const version = (body.tag_name ?? "").replace(/^v/, "");
        const names = releaseAssetNames(version);
        const asset = (name: string) => {
          const url = body.assets?.find((a) => a.name === name)?.browser_download_url ?? null;
          return url && url.startsWith(RELEASE_DOWNLOADS) ? url : null;
        };
        result = {
          release: compareVersions(version, "0.0.0") === null
            ? null
            : {
                version,
                url: body.html_url ?? `https://github.com/${PROJECT_REPOSITORY}/releases`,
                publishedAt: body.published_at ?? null,
                notes: body.body ? body.body.slice(0, 20_000) : null,
                zipUrl: asset(names.zip),
                signatureUrl: asset(names.signature),
              },
          checkedAt: new Date().toISOString(),
          error: null,
        };
      }
    } catch {
      result = { release: null, checkedAt: new Date().toISOString(), error: "UNAVAILABLE" };
    }
    // A failed check is tried again sooner than an answered one.
    await this.redis.set(CACHE_KEY, JSON.stringify(result), "EX", result.error === "UNAVAILABLE" ? 300 : CACHE_SECONDS);
    return result;
  }

  private async readJson<T>(name: string): Promise<T | null> {
    if (!this.dir) return null;
    try {
      return JSON.parse(await readFile(join(this.dir, name), "utf8")) as T;
    } catch {
      return null;
    }
  }

  /** Whether this server can update itself from here, and if not, why. */
  async selfUpdate(): Promise<{ available: boolean; reason: string | null }> {
    if (!this.dir) return { available: false, reason: "NO_UPDATER" };
    const beat = await this.readJson<UpdaterHeartbeat>("updater.json");
    if (!beat || Date.now() - new Date(beat.at).getTime() > 2 * 60 * 1000) return { available: false, reason: "NO_UPDATER" };
    if (!beat.hasKey) return { available: false, reason: "NO_KEY" };
    return { available: true, reason: null };
  }

  /** What the updater last said about an update it is carrying out or has finished. */
  status() {
    return this.readJson<{ state: string; version?: string; message?: string; log?: string; at?: string }>("status.json");
  }

  async overview(refresh = false) {
    const current = runningVersion();
    const latest = await this.latest(refresh);
    const newer = latest.release ? (compareVersions(latest.release.version, current) ?? 0) > 0 : false;
    return { current, ...latest, newer, selfUpdate: await this.selfUpdate(), status: await this.status() };
  }

  /** Leaves the updater a request to install `version` — the latest release, newer than this one, signed. */
  async request(version: string, requestedBy: string) {
    const { release } = await this.latest();
    if (!release || release.version !== version) throw Errors.validation("That is not the latest release.");
    if ((compareVersions(version, runningVersion()) ?? 0) <= 0) throw Errors.validation("This server already runs that version or a newer one.");
    if (!release.zipUrl || !release.signatureUrl) throw Errors.validation("That release has no signed package to install.");
    const ready = await this.selfUpdate();
    if (!ready.available) throw Errors.validation("This server cannot update itself; update it from the server.");
    const request = { version, zipUrl: release.zipUrl, signatureUrl: release.signatureUrl, requestedBy, requestedAt: new Date().toISOString() };
    await mkdir(this.dir!, { recursive: true });
    const tmp = join(this.dir!, `request.${process.pid}.tmp`);
    await writeFile(tmp, JSON.stringify(request));
    await rename(tmp, join(this.dir!, "request.json"));
    return request;
  }
}
