import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";

/**
 * A signed-out reader who reacts to a post is told apart from the next one
 * by a random value their browser keeps in a cookie. Only its SHA-256 is
 * stored, so the table holds nothing that could be replayed as the cookie,
 * and nothing about who or where the reader is.
 */
export const READER_COOKIE = "platform_reader";
const READER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const SHAPE = /^[A-Za-z0-9_-]{32,64}$/;

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** The reader key this request already carries, if any. */
export function readerKeyFrom(request: FastifyRequest): string | null {
  const raw = request.cookies[READER_COOKIE];
  return raw && SHAPE.test(raw) ? hash(raw) : null;
}

/** The reader key, giving the browser one first if it has none. */
export function ensureReaderKey(request: FastifyRequest, reply: FastifyReply): string {
  const existing = readerKeyFrom(request);
  if (existing) return existing;
  const raw = randomBytes(24).toString("base64url");
  reply.setCookie(READER_COOKIE, raw, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    maxAge: READER_COOKIE_MAX_AGE,
  });
  return hash(raw);
}

/** Who is looking: an account, or a signed-out reader's key (or neither). */
export interface ReactionViewer {
  userId: string | null;
  readerKey: string | null;
}

export function reactionViewer(request: FastifyRequest): ReactionViewer {
  const userId = request.currentUser?.id ?? null;
  return { userId, readerKey: userId ? null : readerKeyFrom(request) };
}
