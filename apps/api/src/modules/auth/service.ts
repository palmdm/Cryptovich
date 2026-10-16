import type { Prisma, PrismaClient } from "@platform/db";
import type { Redis } from "ioredis";
import { hashPassword, verifyAgainstDecoy, verifyPassword } from "../../lib/password.js";
import { createSession, revokeSession, sessionIdFor, LOGIN_HISTORY_LIMIT } from "../../lib/session.js";
import { describeUserAgent } from "../../lib/user-agent.js";
import { generateTotpSecret, verifyTotp, totpAuthUri } from "../../lib/totp.js";
import { Errors } from "../../lib/errors.js";
import { verifyTotpLimited } from "../../lib/totp-attempts.js";
import { withScopeLock } from "../../lib/scope-lock.js";
import { BOOTSTRAP_LOCK_KEY } from "../../lib/admin-bootstrap.js";
import { InviteService } from "../invites/service.js";
import { SettingsService } from "../settings/service.js";
import { isUsernameAvailable, RESERVED_USERNAMES } from "../../lib/username-history.js";
import { createEmailToken, consumeEmailToken } from "../../lib/email-token.js";
import { emailProvider } from "../../lib/email.js";
import { config } from "../../config.js";
import type { RegisterInput, LoginInput } from "./schemas.js";

export class AuthService {
  private readonly invites: InviteService;
  private readonly settings: SettingsService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis?: Redis,
  ) {
    this.invites = new InviteService(prisma);
    this.settings = new SettingsService(prisma);
  }

  async register(input: RegisterInput, meta: { userAgent?: string; ipHash?: string }) {
    // Also checked against UsernameHistory: a name someone renamed away
    // from stays reserved to them, so a new signup can't steal it out from
    // under a bookmarked link that still points at the old owner.
    // A name the site uses for a page of its own (`/policy`, `/feed`…) is
    // refused the same way: that account's profile could never be opened.
    if (RESERVED_USERNAMES.has(input.username) || !(await isUsernameAvailable(this.prisma, input.username))) {
      throw Errors.usernameTaken();
    }

    if (input.email) {
      const existingEmail = await this.prisma.user.findUnique({ where: { email: input.email } });
      if (existingEmail) throw Errors.emailTaken();
    }

    // Registration is invite-only unless the operator opened it (the
    // `registrationMode` server setting, defaulting to `REGISTRATION_MODE`),
    // with one exception: an installation with no users at all would
    // otherwise have nobody able to mint the first code. The very first
    // account is therefore created without one and is an administrator.
    const openMode = await this.settings.isRegistrationOpen();

    // Read before the lock only to decide whether an invite needs looking
    // up at all. It is deliberately NOT the value the account's role is
    // derived from — see `isFirstAccount` below.
    const maybeFirstAccount = (await this.prisma.user.count()) === 0;
    // A code typed while registration is open is still redeemed: it is
    // how an account records who brought it, and one that does not work
    // is refused rather than quietly dropped, so the person knows.
    const skipInvite = maybeFirstAccount || (openMode && !input.inviteCode?.trim());
    const invite = skipInvite ? null : await this.invites.findRedeemable(input.inviteCode ?? "");

    // Hashing is deliberately outside the lock below — argon2 takes long
    // enough that holding an advisory lock across it would serialize
    // every registration sharing a code.
    const passwordHash = await hashPassword(input.password);

    const createUser = async (tx: Prisma.TransactionClient) => {
      // Re-counted under the lock. Reusing the pre-lock read here would
      // let two registrations racing on an empty database both see zero
      // and both be created as administrators — on a fresh invite-only
      // install that is the one moment registration is unauthenticated.
      const isFirstAccount = maybeFirstAccount && (await tx.user.count()) === 0;

      // Lost the race for the first account, and never supplied a code
      // because none was required when this request started.
      if (!openMode && !isFirstAccount && !invite) {
        throw Errors.validation("That invite code isn't valid.");
      }

      if (invite) {
        // Re-read under the lock: another registration may have taken the
        // code's last use between findRedeemable and here.
        const used = await tx.inviteRedemption.count({ where: { inviteCodeId: invite.id } });
        if (invite.maxUses !== null && used >= invite.maxUses) {
          throw Errors.validation("That invite code isn't valid.");
        }
      }

      const created = await tx.user.create({
        data: {
          username: input.username,
          email: input.email,
          passwordHash,
          // Everyone can publish from the start, so a plain account is
          // already a CREATOR. The first account on an empty install is
          // still the administrator.
          role: isFirstAccount ? "ADMIN" : "CREATOR",
          // Publishing should never be gated behind a separate "become a
          // creator" step, so the public profile exists from the first
          // moment. The display name starts as the username; the author
          // changes it whenever they like.
          creatorProfile: { create: { displayName: input.username } },
        },
      });

      if (invite) {
        await tx.inviteRedemption.create({ data: { inviteCodeId: invite.id, userId: created.id } });
      }

      return created;
    };

    // The lock guards shared state: an invite's remaining uses, and the
    // "first account" decision that grants admin. Open-mode registration
    // has neither, so it doesn't serialize on a global key.
    const user =
      invite || maybeFirstAccount
        ? await withScopeLock(this.prisma, invite ? `invite:${invite.id}` : BOOTSTRAP_LOCK_KEY, createUser)
        : await this.prisma.$transaction(createUser);

    const session = await createSession(this.prisma, user.id, meta);
    return { user, session };
  }

  async login(input: LoginInput, meta: { userAgent?: string; ipHash?: string }) {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ username: input.identifier }, { email: input.identifier }],
        deletedAt: null,
      },
    });
    if (!user || !user.passwordHash) {
      await verifyAgainstDecoy(input.password);
      throw Errors.invalidCredentials();
    }

    const valid = await verifyPassword(user.passwordHash, input.password);
    if (!valid) throw Errors.invalidCredentials();

    if (user.suspendedAt) throw Errors.accountSuspended();

    if (user.twoFactorEnabled) {
      if (!input.code) throw Errors.twoFactorRequired();
      await verifyTotpLimited(this.redis, user, input.code);
    }

    const session = await createSession(this.prisma, user.id, meta);
    return { user, session };
  }

  /**
   * Starts a password reset.
   *
   * Answers identically whether or not the address belongs to an
   * account: this endpoint is unauthenticated, so distinguishing them
   * turns it into an oracle for which addresses are registered. The
   * caller gets the same "if that address is here, mail is on its way"
   * either way.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const mail = await emailProvider(this.prisma);
    if (!mail.enabled) {
      // Refused up front rather than accepting a request whose mail can
      // never arrive. Not an enumeration risk: it is true of every
      // address on this server, so it reveals nothing about any one.
      throw Errors.validation(
        "This server cannot send email, so password reset is unavailable. Ask the administrator to reset it for you.",
      );
    }

    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: { id: true, email: true },
    });
    if (!user?.email) return;

    const token = await createEmailToken(this.prisma, user.id, "PASSWORD_RESET", user.email);
    const link = `${config.webOrigin}/reset-password?token=${encodeURIComponent(token)}`;

    try {
      await mail.send({
        to: user.email,
        subject: "Reset your Cryptovich password",
        text:
          `Open this link within the hour to choose a new password:\n\n${link}\n\n` +
          "If you didn't ask for this, ignore this message — your password is unchanged.",
      });
    } catch {
      // A bounce must not become a signal either. The request already
      // looks the same from outside; the failure is the operator's to
      // find in the logs.
    }
  }

  /**
   * Completes a reset. Every session is revoked alongside the password
   * change — otherwise whoever prompted the reset keeps whatever session
   * they already had, which is the exact thing a reset is meant to end.
   */
  async confirmPasswordReset(token: string, newPassword: string): Promise<void> {
    const claim = await consumeEmailToken(this.prisma, token, "PASSWORD_RESET");
    if (!claim) throw Errors.validation("That reset link is invalid or has expired. Request a new one.");

    const passwordHash = await hashPassword(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: claim.userId }, data: { passwordHash } }),
      this.prisma.session.updateMany({
        where: { userId: claim.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  /** Sends a verification link to the address already on the account. */
  async requestEmailVerification(userId: string): Promise<void> {
    const mail = await emailProvider(this.prisma);
    if (!mail.enabled) {
      throw Errors.validation("This server cannot send email, so address verification is unavailable.");
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.email) throw Errors.validation("Add an email address to your account first.");
    if (user.emailVerifiedAt) return;

    const token = await createEmailToken(this.prisma, user.id, "EMAIL_VERIFICATION", user.email);
    const link = `${config.webOrigin}/verify-email?token=${encodeURIComponent(token)}`;
    await mail.send({
      to: user.email,
      subject: "Confirm your Cryptovich email address",
      text: `Confirm this address by opening the link below within the hour:\n\n${link}`,
    });
  }

  async confirmEmailVerification(token: string): Promise<void> {
    const claim = await consumeEmailToken(this.prisma, token, "EMAIL_VERIFICATION");
    if (!claim) throw Errors.validation("That confirmation link is invalid or has expired.");

    // Only marks the address the link was actually sent to. Changing the
    // email after requesting must not be confirmable by the old link.
    const updated = await this.prisma.user.updateMany({
      where: { id: claim.userId, email: claim.sentTo },
      data: { emailVerifiedAt: new Date() },
    });
    if (updated.count === 0) {
      throw Errors.validation("That address is no longer on this account.");
    }
  }

  async logout(token: string) {
    await revokeSession(this.prisma, token);
  }

  /**
   * Ends one of the account's own sessions — a device left signed in
   * somewhere. Another account's session id is not found rather than
   * refused, so this cannot be used to learn which ids exist. Ending one
   * that already ended is not an error: the outcome asked for holds.
   */
  async endSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.prisma.session.findFirst({ where: { id: sessionId, userId }, select: { id: true } });
    if (!session) throw Errors.notFound("Session");
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** Every open session of the account except the one asking. Returns how many ended. */
  async endOtherSessions(userId: string, currentSessionId: string): Promise<number> {
    const { count } = await this.prisma.session.updateMany({
      where: { userId, id: { not: currentSessionId }, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  /**
   * The account's sign-ins, newest first: when, from what, and whether that
   * session is still open. A session row outlives its sign-out, so the list
   * needs no table of its own. The address is stored only as a hash and is
   * deliberately not part of this — it says nothing to the person reading.
   */
  async loginHistory(userId: string, currentToken: string) {
    const [currentId, rows] = await Promise.all([
      sessionIdFor(this.prisma, currentToken),
      this.prisma.session.findMany({
        where: { userId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: LOGIN_HISTORY_LIMIT,
        select: { id: true, userAgent: true, createdAt: true, expiresAt: true, revokedAt: true, method: true, ephemeral: true },
      }),
    ]);
    const now = Date.now();
    return rows.map((row) => ({
      id: row.id,
      signedInAt: row.createdAt,
      userAgent: row.userAgent,
      ...describeUserAgent(row.userAgent),
      current: row.id === currentId,
      status: row.revokedAt ? "SIGNED_OUT" : row.expiresAt.getTime() <= now ? "EXPIRED" : "ACTIVE",
      method: row.method,
      temporary: row.ephemeral,
    }));
  }

  /**
   * Two-step enrollment: `setup2fa` generates and stores a secret but does
   * NOT enable 2FA yet — only a subsequent successful `verify2fa` call
   * (proving the user actually saved the code somewhere) flips
   * `twoFactorEnabled`. This prevents a user from locking themselves out
   * with a QR code they never actually scanned.
   *
   * Refused while two-factor sign-in is on: overwriting the secret then
   * needed no proof of the current one, so anyone holding a session could
   * move a person's second factor to their own phone. Moving it to a new
   * device means turning it off first — which takes the password and a
   * current code.
   */
  async setup2fa(userId: string, username: string) {
    const current = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { twoFactorEnabled: true } });
    if (current.twoFactorEnabled) {
      throw Errors.validation("Two-factor sign-in is already on. Turn it off first to move it to another device.");
    }
    const secret = generateTotpSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorSecret: secret } });
    return { secret, otpauthUri: totpAuthUri(secret, username) };
  }

  async verify2fa(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.twoFactorSecret || !verifyTotp(user.twoFactorSecret, code)) throw Errors.invalidTwoFactorCode();
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
  }

  /**
   * Requires both factors to turn 2FA off — password AND a current TOTP
   * code — so a leaked/reused password alone can't disable the very
   * protection it's meant to be insufficient against on its own.
   */
  async disable2fa(userId: string, password: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, password))) throw Errors.invalidCredentials();
    if (!user.twoFactorSecret || !verifyTotp(user.twoFactorSecret, code)) throw Errors.invalidTwoFactorCode();
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: false, twoFactorSecret: null } });
  }
}
