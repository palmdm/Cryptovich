/** Where Cryptovich lives and who makes it — the "About" window, the update check. */
export const PROJECT_REPOSITORY = "palmdm/Cryptovich";
export const PROJECT_URL = `https://github.com/${PROJECT_REPOSITORY}`;
export const PROJECT_AUTHORS = ["PalmDM", "Claude"] as const;

/** Release assets: the zip `scripts/make-release.sh` packs, and its signature. */
export function releaseAssetNames(version: string): { zip: string; signature: string } {
  return { zip: `cryptovich-${version}.zip`, signature: `cryptovich-${version}.zip.sig` };
}

/** A plain "1.2.3" (an optional leading "v" is dropped), or null. */
export function parseVersion(value: string): [number, number, number] | null {
  const match = /^v?(\d{1,5})\.(\d{1,5})\.(\d{1,6})$/.exec(value.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Negative when `a` is older than `b`, 0 when the same, positive when newer; null if either is not a version. */
export function compareVersions(a: string, b: string): number | null {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}
