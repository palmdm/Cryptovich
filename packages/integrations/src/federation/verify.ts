import { createHash, createVerify } from "node:crypto";
import { safeFetch } from "../feed/safe-fetch.js";
import type { RequestSigner } from "./signing.js";

/**
 * Verifying HTTP Signatures on *inbound* activities.
 *
 * This is the load-bearing security control of inbound federation.
 * Without it anyone who can reach the inbox can post an activity claiming
 * to be any actor on any server: a forged `Follow` to inflate a follower
 * count is the harmless end, a forged `Delete` attributed to someone
 * else's actor is not. Nothing is acted on until the signature over the
 * request verifies against the public key published by the actor the
 * activity claims to come from.
 *
 * Implementations differ — Mastodon, Sharkey, Misskey, Pleroma, Lemmy and
 * others all sign slightly differently in which headers they cover — so
 * the signing string is rebuilt from the `headers=` list the sender
 * declared, rather than from a fixed list we expect. What is *not*
 * negotiable is the minimum set that must be covered, checked below.
 */

export class SignatureVerificationError extends Error {}

/** The parts of a remote actor this module needs. */
export interface RemoteActor {
  id: string;
  publicKeyPem: string;
}

export type ActorResolver = (keyId: string) => Promise<RemoteActor | null>;

/**
 * Requests older than this are refused. A signature that stays valid
 * indefinitely is a replay waiting to happen; too tight a window breaks
 * interoperability with servers whose clocks drift. Five minutes is the
 * usual compromise, and is what draft-cavage suggests.
 */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Headers that must be covered by the signature. `(request-target)` binds
 * it to this path and method, `host` to this server, `date` to now, and
 * `digest` to this exact body — omit any one of them and a captured
 * signature can be replayed against a different request.
 */
const REQUIRED_COVERED = ["(request-target)", "host", "date", "digest"];

interface ParsedSignature {
  keyId: string;
  algorithm?: string;
  headers: string[];
  signature: string;
}

/** `keyId="…",algorithm="…",headers="…",signature="…"` — quoted, comma-separated. */
export function parseSignatureHeader(header: string): ParsedSignature {
  const fields: Record<string, string> = {};
  // Values are quoted and may contain commas (base64 never does, but
  // keyId URLs can), so this walks quoted segments rather than splitting.
  const re = /(\w+)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(header)) !== null) fields[match[1]!] = match[2]!;

  if (!fields.keyId) throw new SignatureVerificationError("Signature header has no keyId.");
  if (!fields.signature) throw new SignatureVerificationError("Signature header has no signature.");

  return {
    keyId: fields.keyId,
    algorithm: fields.algorithm,
    // Absent `headers` means "date" only, per the draft — which we then
    // reject below for not covering enough.
    headers: (fields.headers ?? "date").split(/\s+/).filter(Boolean),
    signature: fields.signature,
  };
}

/**
 * Fetches the actor named by a keyId to read its public key. The keyId is
 * attacker-supplied, so it goes through the same SSRF guard as every
 * other URL this server is told to fetch — otherwise an inbox delivery
 * becomes a way to make this server probe its own network.
 */
export async function fetchActorKey(
  keyId: string,
  /** Injectable so tests exercise the identity checks without a real DNS lookup. */
  guard?: (url: string) => Promise<void>,
  /**
   * Signs the fetch as this server. Without it a server in authorized-fetch
   * mode (Mastodon's secure mode) answers 401, the key is never read, and
   * every delivery from that server is refused.
   */
  sign?: RequestSigner,
): Promise<RemoteActor | null> {
  const actorUrl = keyId.split("#")[0]!;

  // safeFetch re-checks every redirect hop. Checking only `actorUrl` and
  // letting the runtime follow redirects would let a host that passes the
  // guard bounce this request to a link-local or loopback address.
  const res = await safeFetch(
    actorUrl,
    { headers: { Accept: "application/activity+json, application/ld+json" }, sign },
    guard,
  );
  if (!res.ok) return null;

  const actor = (await res.json()) as {
    id?: string;
    publicKey?: { id?: string; owner?: string; publicKeyPem?: string } | { id?: string; publicKeyPem?: string }[];
  };

  // Some implementations publish an array of keys.
  const keys = Array.isArray(actor.publicKey) ? actor.publicKey : actor.publicKey ? [actor.publicKey] : [];
  const key = keys.find((k) => k.id === keyId) ?? keys[0];
  if (!key?.publicKeyPem || !actor.id) return null;

  // A document is only authoritative for identities on its own origin.
  //
  // Without this, anyone who controls any host can impersonate any actor
  // anywhere: serve `{"id": "https://mastodon.social/users/someone",
  // "publicKey": <their own key>}` from their own server, sign with the
  // matching private key, and the signature verifies while the identity
  // returned is somebody else's. The activity's `actor` check does not
  // catch it either, since the attacker sets that to the same forged id.
  //
  // Origin rather than exact URL, because an actor legitimately redirects
  // within its own host (`/users/alice` to `/@alice`), but never across
  // hosts — a document claiming an id on another origin is claiming an
  // identity it cannot speak for.
  if (!sameOrigin(actor.id, actorUrl)) return null;
  // The key must belong to the actor publishing it, where it says so.
  if (key.id && !sameOrigin(key.id, actorUrl)) return null;
  const owner = (key as { owner?: string }).owner;
  if (owner && owner !== actor.id) return null;

  return { id: actor.id, publicKeyPem: key.publicKeyPem };
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

export interface InboundRequest {
  method: string;
  /** Path with query, as it arrived — this is what `(request-target)` covers. */
  path: string;
  headers: Record<string, string | string[] | undefined>;
  /** The exact bytes received, before any JSON parsing. */
  rawBody: string;
  /**
   * The public host values this server answers to, most authoritative
   * first. The sender signed the host *they* addressed, which a reverse
   * proxy rewrites on the way in — and a chain of proxies may leave
   * several candidates (`x-forwarded-host: public.example, internal:3000`,
   * where reading "the" forwarded host gives the internal one and every
   * signature then fails). Each is tried until one verifies; omitted, only
   * the `host` header is used, as before.
   */
  hostCandidates?: string[];
}

function header(req: InboundRequest, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Verifies an inbound signed request and returns the actor that signed
 * it. Throws on anything that does not check out — callers treat a throw
 * as "drop this activity", never as "process it anyway".
 */
export async function verifySignedRequest(
  req: InboundRequest,
  resolveActor: ActorResolver = fetchActorKey,
): Promise<RemoteActor> {
  const signatureHeader = header(req, "signature");
  if (!signatureHeader) throw new SignatureVerificationError("Request is not signed.");

  const parsed = parseSignatureHeader(signatureHeader);

  if (parsed.algorithm && !/^(rsa-sha256|hs2019)$/i.test(parsed.algorithm)) {
    throw new SignatureVerificationError(`Unsupported signature algorithm: ${parsed.algorithm}`);
  }

  const covered = parsed.headers.map((h) => h.toLowerCase());
  for (const required of REQUIRED_COVERED) {
    if (!covered.includes(required)) {
      throw new SignatureVerificationError(`Signature does not cover ${required}.`);
    }
  }

  // The body must be exactly what was signed. Comparing the digest before
  // touching the JSON means a tampered body is rejected without ever
  // being parsed.
  const digestHeader = header(req, "digest");
  if (!digestHeader) throw new SignatureVerificationError("Request has no Digest header.");
  const expected = `SHA-256=${createHash("sha256").update(req.rawBody).digest("base64")}`;
  if (!digestsMatch(digestHeader, expected)) {
    throw new SignatureVerificationError("Digest does not match the request body.");
  }

  const dateHeader = header(req, "date");
  if (!dateHeader) throw new SignatureVerificationError("Request has no Date header.");
  const sent = Date.parse(dateHeader);
  if (Number.isNaN(sent)) throw new SignatureVerificationError("Request Date is unreadable.");
  if (Math.abs(Date.now() - sent) > MAX_CLOCK_SKEW_MS) {
    throw new SignatureVerificationError("Request Date is outside the accepted window.");
  }

  // A key we cannot fetch — the actor is gone, the host is unreachable,
  // the URL is refused by the SSRF guard — means we cannot verify the
  // sender. That is a rejected delivery, not a server fault, so the
  // failure is folded into the same error the caller already handles as
  // "drop this" rather than escaping as an unhandled throw.
  let actor: RemoteActor | null;
  try {
    actor = await resolveActor(parsed.keyId);
  } catch (err) {
    throw new SignatureVerificationError(
      `Could not resolve the signing key: ${err instanceof Error ? err.message : "lookup failed"}`,
    );
  }
  if (!actor) throw new SignatureVerificationError("Could not resolve the signing key.");

  const hosts = (req.hostCandidates?.length ? req.hostCandidates : [header(req, "host")])
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    // A proxy may leave a comma-separated chain; each element is a host
    // some hop claimed, so each is worth trying.
    .flatMap((value) => value.split(",").map((part) => part.trim()))
    .filter((value, index, all) => all.indexOf(value) === index);

  if (hosts.length === 0) throw new SignatureVerificationError("Request has no Host header.");

  const signingStringFor = (host: string) =>
    covered
      .map((name) => {
        if (name === "(request-target)") return `(request-target): ${req.method.toLowerCase()} ${req.path}`;
        const value = name === "host" ? host : header(req, name);
        if (value === undefined) {
          throw new SignatureVerificationError(`Signature covers ${name}, which the request does not carry.`);
        }
        return `${name}: ${value}`;
      })
      .join("\n");

  const ok = hosts.some((host) =>
    createVerify("RSA-SHA256").update(signingStringFor(host)).verify(actor.publicKeyPem, parsed.signature, "base64"),
  );

  if (!ok) {
    throw new SignatureVerificationError(
      `Signature does not verify against the actor's key (tried host: ${hosts.join(", ")}).`,
    );
  }
  return actor;
}

/**
 * A Digest header may carry several algorithms, comma-separated, in any
 * order and with any casing on the algorithm name. Only the SHA-256 entry
 * is compared; its base64 value is case-sensitive.
 */
function digestsMatch(received: string, expected: string): boolean {
  const wanted = expected.slice("SHA-256=".length);
  return received
    .split(",")
    .map((part) => part.trim())
    .some((part) => {
      const eq = part.indexOf("=");
      if (eq === -1) return false;
      const algorithm = part.slice(0, eq).trim().toLowerCase();
      const value = part.slice(eq + 1).trim();
      return algorithm === "sha-256" && value === wanted;
    });
}
