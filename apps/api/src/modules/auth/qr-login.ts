import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@platform/db";
import type { Redis } from "ioredis";
import { createSession } from "../../lib/session.js";
import { describeUserAgent } from "../../lib/user-agent.js";
import { AppError, Errors } from "../../lib/errors.js";

/**
 * Signing a computer in from a phone that already is.
 *
 * The computer asks for a request (`start`): a random id it shows as a QR
 * code, a secret only it holds (an httpOnly cookie, so only that browser
 * can collect the session), and a two-digit number on its screen. The
 * signed-in phone opens the code, sees which device is asking, and must
 * pick that number out of three — someone who sends you *their* code
 * cannot see the screen it is on. It then says whether this is their own
 * computer or a temporary sign-in. The computer, checking every couple of
 * seconds, collects the session once (`claim`). Everything lives in
 * Redis for two minutes; nothing is kept once it is used.
 */
export const QR_PENDING_SECONDS = 120;
const QR_DONE_SECONDS = 60;

interface QrRequest {
  secretHash: string;
  userAgent: string | null;
  createdAt: number;
  number: string;
  status: "pending" | "approved" | "rejected";
  userId?: string;
  temporary?: boolean;
}

const key = (id: string) => `qrlogin:${id}`;
const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

function hashSecret(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function twoDigits(): string {
  return String(randomInt(10, 100));
}

export const qrNumberMismatch = () =>
  new AppError(400, "That was not the number on the computer, so this sign-in was cancelled.", "QR_NUMBER_MISMATCH");

export class QrLoginService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
  ) {}

  private async read(id: string): Promise<QrRequest | null> {
    if (!ID_PATTERN.test(id)) return null;
    const raw = await this.redis.get(key(id));
    return raw ? (JSON.parse(raw) as QrRequest) : null;
  }

  private async write(id: string, request: QrRequest, seconds: number) {
    await this.redis.set(key(id), JSON.stringify(request), "EX", seconds);
  }

  private ownedBy(request: QrRequest, secret: string | undefined): boolean {
    if (!secret) return false;
    return timingSafeEqual(Buffer.from(request.secretHash, "hex"), hashSecret(secret));
  }

  async start(userAgent: string | undefined) {
    const id = randomBytes(16).toString("base64url");
    const secret = randomBytes(32).toString("base64url");
    const request: QrRequest = {
      secretHash: hashSecret(secret).toString("hex"),
      userAgent: userAgent?.slice(0, 255) ?? null,
      createdAt: Date.now(),
      number: twoDigits(),
      status: "pending",
    };
    await this.write(id, request, QR_PENDING_SECONDS);
    return { id, secret, number: request.number, expiresAt: new Date(request.createdAt + QR_PENDING_SECONDS * 1000) };
  }

  /** What the phone shows: who is asking, and three numbers to choose from. */
  async describe(id: string) {
    const request = await this.read(id);
    if (!request || request.status !== "pending") throw Errors.notFound("This sign-in request");
    const choices = new Set([request.number]);
    while (choices.size < 3) choices.add(twoDigits());
    return {
      device: describeUserAgent(request.userAgent),
      requestedAt: new Date(request.createdAt),
      choices: [...choices].sort(() => randomInt(0, 2) - 0.5),
    };
  }

  async approve(id: string, userId: string, number: string, temporary: boolean) {
    const request = await this.read(id);
    if (!request || request.status !== "pending") throw Errors.notFound("This sign-in request");
    if (number !== request.number) {
      // One try: a wrong pick ends the request for good.
      await this.write(id, { ...request, status: "rejected" }, QR_DONE_SECONDS);
      throw qrNumberMismatch();
    }
    await this.write(id, { ...request, status: "approved", userId, temporary }, QR_DONE_SECONDS);
  }

  async reject(id: string) {
    const request = await this.read(id);
    if (!request || request.status !== "pending") throw Errors.notFound("This sign-in request");
    await this.write(id, { ...request, status: "rejected" }, QR_DONE_SECONDS);
  }

  /** For the computer that asked, and only for it. */
  async status(id: string, secret: string | undefined): Promise<"pending" | "approved" | "rejected" | "expired"> {
    const request = await this.read(id);
    if (!request) return "expired";
    if (!this.ownedBy(request, secret)) throw Errors.notFound("This sign-in request");
    return request.status;
  }

  /** The approved session, handed over once to the computer that asked. */
  async claim(id: string, secret: string | undefined, meta: { userAgent?: string; ipHash?: string }) {
    const request = await this.read(id);
    if (!request || !this.ownedBy(request, secret)) throw Errors.notFound("This sign-in request");
    if (request.status !== "approved" || !request.userId) throw Errors.validation("This sign-in has not been approved.");
    // Whoever deletes it first is the one sign-in it becomes.
    if ((await this.redis.del(key(id))) !== 1) throw Errors.notFound("This sign-in request");
    const user = await this.prisma.user.findFirst({ where: { id: request.userId, deletedAt: null, suspendedAt: null } });
    if (!user) throw Errors.notFound("Account");
    const session = await createSession(this.prisma, user.id, meta, { method: "qr", ephemeral: request.temporary === true });
    return { user, session };
  }
}
