import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@platform/db";
import type { Redis } from "ioredis";
import { APP_NAME } from "@platform/shared";
import { config } from "../../config.js";
import { AppError, Errors } from "../../lib/errors.js";
import { createSession } from "../../lib/session.js";
import { describeUserAgent } from "../../lib/user-agent.js";
import {
  checkAuthenticatorData,
  checkClientData,
  coseToJwk,
  decodeCbor,
  parseAuthenticatorData,
  sha256,
  SUPPORTED_ALGORITHMS,
  verifyAssertionSignature,
  WebAuthnError,
} from "../../lib/webauthn.js";

const CHALLENGE_SECONDS = 5 * 60;
const MAX_PASSKEYS = 10;

const passkeyRefused = () =>
  new AppError(400, "That passkey could not be used. Try again, or sign in with your password.", "PASSKEY_FAILED");

/** The site a passkey belongs to: the web origin's host, and the origin itself. */
function relyingParty() {
  const url = new URL(config.webOrigin);
  return { id: url.hostname, origin: url.origin, name: APP_NAME };
}

interface RegistrationInput {
  rawId: string;
  response: { clientDataJSON: string; attestationObject: string; transports?: string[] };
  name?: string;
}

interface AssertionInput {
  challengeId: string;
  rawId: string;
  response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle?: string | null };
}

const fromB64url = (value: string) => Buffer.from(value, "base64url");

/**
 * Passkeys: signing in with the fingerprint, face or PIN the device
 * already guards itself with. The passkey is discoverable, so the sign-in
 * page needs no username; the device verifies the person (a passkey is
 * two factors on its own, so no code is asked after it); only the public
 * key is kept here. Checking is in lib/webauthn.ts.
 */
export class PasskeyService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
  ) {}

  async list(userId: string) {
    const rows = await this.prisma.passkey.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, createdAt: true, lastUsedAt: true },
    });
    return rows;
  }

  async remove(userId: string, id: string) {
    const removed = await this.prisma.passkey.deleteMany({ where: { id, userId } });
    if (removed.count === 0) throw Errors.notFound("Passkey");
  }

  async registrationOptions(user: { id: string; username: string }) {
    const existing = await this.prisma.passkey.findMany({ where: { userId: user.id }, select: { credentialId: true, transports: true } });
    if (existing.length >= MAX_PASSKEYS) throw Errors.validation(`An account can have up to ${MAX_PASSKEYS} passkeys.`);
    const challenge = randomBytes(32).toString("base64url");
    await this.redis.set(`webauthn:reg:${user.id}`, challenge, "EX", CHALLENGE_SECONDS);
    const rp = relyingParty();
    return {
      challenge,
      rp: { id: rp.id, name: rp.name },
      user: { id: Buffer.from(user.id).toString("base64url"), name: user.username, displayName: user.username },
      pubKeyCredParams: SUPPORTED_ALGORITHMS.map((alg) => ({ type: "public-key", alg })),
      timeout: 60_000,
      attestation: "none",
      authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
      excludeCredentials: existing.map((p) => ({
        type: "public-key",
        id: p.credentialId,
        ...(p.transports ? { transports: p.transports.split(",") } : {}),
      })),
    };
  }

  async register(userId: string, input: RegistrationInput, userAgent: string | undefined) {
    const challenge = await this.redis.getdel(`webauthn:reg:${userId}`);
    if (!challenge) throw Errors.validation("That took too long. Start adding the passkey again.");
    const rp = relyingParty();
    let credentialId: string;
    let jwk: object;
    let alg: number;
    let signCount: number;
    try {
      checkClientData(fromB64url(input.response.clientDataJSON), { type: "webauthn.create", challenge, origin: rp.origin });
      const { value } = decodeCbor(fromB64url(input.response.attestationObject));
      if (!(value instanceof Map) || !Buffer.isBuffer(value.get("authData"))) throw new WebAuthnError("Bad attestation object.");
      const data = parseAuthenticatorData(value.get("authData") as Buffer);
      checkAuthenticatorData(data, rp.id);
      if (!data.credentialId || !data.credentialPublicKey) throw new WebAuthnError("No credential in the response.");
      if (!data.credentialId.equals(fromB64url(input.rawId))) throw new WebAuthnError("The credential id does not match.");
      ({ jwk, alg } = coseToJwk(data.credentialPublicKey));
      credentialId = data.credentialId.toString("base64url");
      signCount = data.signCount;
    } catch (err) {
      if (err instanceof WebAuthnError) throw passkeyRefused();
      throw err;
    }
    const device = describeUserAgent(userAgent);
    const name = input.name?.trim() || [device.browser, device.os].filter(Boolean).join(" · ") || "Passkey";
    try {
      const created = await this.prisma.passkey.create({
        data: {
          userId,
          credentialId,
          publicKey: JSON.stringify(jwk),
          alg,
          signCount: BigInt(signCount),
          transports: (input.response.transports ?? []).filter((t) => /^[a-z-]{1,20}$/.test(t)).slice(0, 8).join(",") || null,
          name: name.slice(0, 60),
        },
        select: { id: true, name: true, createdAt: true, lastUsedAt: true },
      });
      return created;
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") throw Errors.validation("This passkey is already saved.");
      throw err;
    }
  }

  async loginOptions() {
    const challengeId = randomBytes(16).toString("base64url");
    const challenge = randomBytes(32).toString("base64url");
    await this.redis.set(`webauthn:auth:${challengeId}`, challenge, "EX", CHALLENGE_SECONDS);
    // No allow-list: the device offers the passkeys it holds for this site.
    return { challengeId, challenge, rpId: relyingParty().id, timeout: 60_000, userVerification: "required", allowCredentials: [] };
  }

  async login(input: AssertionInput, meta: { userAgent?: string; ipHash?: string }) {
    if (!/^[A-Za-z0-9_-]{22}$/.test(input.challengeId)) throw passkeyRefused();
    const challenge = await this.redis.getdel(`webauthn:auth:${input.challengeId}`);
    if (!challenge) throw passkeyRefused();
    const { passkey, signCount } = await this.verify(challenge, input);
    const user = await this.prisma.user.findFirst({ where: { id: passkey.userId, deletedAt: null } });
    if (!user) throw passkeyRefused();
    if (user.suspendedAt) throw Errors.accountSuspended();
    await this.prisma.passkey.update({ where: { id: passkey.id }, data: { signCount: BigInt(signCount), lastUsedAt: new Date() } });
    const session = await createSession(this.prisma, user.id, meta, { method: "passkey" });
    return { user, session };
  }

  /**
   * A fresh proof from one of this account's own passkeys, for a step that
   * asks more than a session (the parameters page). `scope` ties the
   * challenge to that step and session; only the account's passkeys are
   * offered. Null when the account has none.
   */
  async confirmOptions(userId: string, scope: string) {
    const held = await this.prisma.passkey.findMany({ where: { userId }, select: { credentialId: true, transports: true } });
    if (held.length === 0) return null;
    const challenge = randomBytes(32).toString("base64url");
    await this.redis.set(`webauthn:confirm:${scope}`, challenge, "EX", CHALLENGE_SECONDS);
    return {
      challenge,
      rpId: relyingParty().id,
      timeout: 60_000,
      userVerification: "required",
      allowCredentials: held.map((p) => ({ type: "public-key", id: p.credentialId, ...(p.transports ? { transports: p.transports.split(",") } : {}) })),
    };
  }

  async confirm(userId: string, scope: string, input: Omit<AssertionInput, "challengeId">): Promise<void> {
    const challenge = await this.redis.getdel(`webauthn:confirm:${scope}`);
    if (!challenge) throw passkeyRefused();
    const { passkey, signCount } = await this.verify(challenge, input);
    // Someone else's passkey proves nothing about this account.
    if (passkey.userId !== userId) throw passkeyRefused();
    await this.prisma.passkey.update({ where: { id: passkey.id }, data: { signCount: BigInt(signCount), lastUsedAt: new Date() } });
  }

  /** Every check an assertion must pass: origin, site, presence and verification, signature, counter. */
  private async verify(challenge: string, input: Omit<AssertionInput, "challengeId">) {
    const passkey = await this.prisma.passkey.findUnique({ where: { credentialId: fromB64url(input.rawId).toString("base64url") } });
    if (!passkey) throw passkeyRefused();
    const rp = relyingParty();
    let signCount: number;
    try {
      if (input.response.userHandle && fromB64url(input.response.userHandle).toString() !== passkey.userId) {
        throw new WebAuthnError("The passkey belongs to another account.");
      }
      const clientData = fromB64url(input.response.clientDataJSON);
      checkClientData(clientData, { type: "webauthn.get", challenge, origin: rp.origin });
      const authData = fromB64url(input.response.authenticatorData);
      const parsed = parseAuthenticatorData(authData);
      checkAuthenticatorData(parsed, rp.id);
      const signed = Buffer.concat([authData, sha256(clientData)]);
      if (!verifyAssertionSignature(JSON.parse(passkey.publicKey), passkey.alg, signed, fromB64url(input.response.signature))) {
        throw new WebAuthnError("The signature does not check out.");
      }
      // A counter that does not move forward means a copied authenticator
      // (many passkeys always send 0, which is allowed).
      signCount = parsed.signCount;
      if ((signCount !== 0 || passkey.signCount !== 0n) && BigInt(signCount) <= passkey.signCount) {
        throw new WebAuthnError("The signature counter went backwards.");
      }
    } catch (err) {
      if (err instanceof WebAuthnError) throw passkeyRefused();
      throw err;
    }
    return { passkey, signCount };
  }
}
