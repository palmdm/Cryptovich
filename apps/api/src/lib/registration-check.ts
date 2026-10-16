import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import { config } from "../config.js";
import { AppError } from "./errors.js";
import type { SettingsService } from "../modules/settings/service.js";

/**
 * Accounts are made in a browser, on this site — not by a script.
 *
 * The browser signs up through the same `POST /auth/register` any client
 * could call, so the endpoint cannot simply be hidden. Instead a sign-up
 * has to show three things a script does not have for free:
 *
 *  - it comes from this site's own origin (the `Origin` header a browser
 *    always sends with a POST) and carries no API token;
 *  - it answers a one-time challenge the server issued a moment ago;
 *  - the answer cost real work: a nonce whose SHA-256, with the
 *    challenge's salt, starts with N zero bits. A second or so in a
 *    browser; for a script creating thousands of accounts, thousands of
 *    those seconds — on top of the per-address rate limit.
 *
 * None of it involves a third party, which a privacy-first site cannot
 * send its visitors to.
 */
const CHALLENGE_TTL_SECONDS = 10 * 60;
const KEY_PREFIX = "regchal:";

export const registrationRefused = () =>
  new AppError(
    400,
    "Accounts can only be created on the site itself, in a browser. Reload the sign-up page and try again.",
    "REGISTRATION_CHECK_FAILED",
  );

// Whether the check runs, and how hard the proof of work is, are the
// `registrationBotCheck` / `registrationPowBits` settings (REGISTRATION_BOT_CHECK
// and REGISTRATION_POW_BITS in .env until an administrator saves them).

export function leadingZeroBits(digest: Uint8Array): number {
  let bits = 0;
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

export async function issueChallenge(redis: Redis, settings: SettingsService) {
  const id = randomUUID();
  const salt = randomBytes(16).toString("hex");
  const bits = await settings.proofOfWorkBits();
  await redis.set(`${KEY_PREFIX}${id}`, `${bits}:${salt}`, "EX", CHALLENGE_TTL_SECONDS);
  return { id, salt, bits };
}

/** Throws the one refusal for every failure, so a script learns nothing from which check it tripped. */
export async function verifyRegistrationRequest(
  request: FastifyRequest,
  redis: Redis,
  body: unknown,
  settings: SettingsService,
): Promise<void> {
  if (!(await settings.registrationBotCheck())) return;

  if (request.headers.authorization) throw registrationRefused();

  const origin = request.headers.origin;
  let sameSite = false;
  try {
    // Host, not the whole origin: a proxy that ends TLS in front of the
    // site must not turn https into a refusal.
    sameSite = Boolean(origin) && new URL(origin!).host === new URL(config.webOrigin).host;
  } catch {
    sameSite = false;
  }
  if (!sameSite) throw registrationRefused();

  const { challengeId, nonce } = (body ?? {}) as { challengeId?: unknown; nonce?: unknown };
  if (typeof challengeId !== "string" || !/^[0-9a-f-]{36}$/.test(challengeId)) throw registrationRefused();
  if (typeof nonce !== "string" || !/^\d{1,15}$/.test(nonce)) throw registrationRefused();

  // Taken and deleted in one step: an answer is good for one account.
  const stored = await redis.getdel(`${KEY_PREFIX}${challengeId}`);
  if (!stored) throw registrationRefused();
  const [bitsText, salt] = stored.split(":");
  const digest = createHash("sha256").update(`${salt}:${nonce}`).digest();
  if (leadingZeroBits(digest) < Number(bitsText)) throw registrationRefused();
}
