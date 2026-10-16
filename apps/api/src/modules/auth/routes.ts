import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  registerSchema,
  loginSchema,
  verify2faSchema,
  disable2faSchema,
  requestPasswordResetSchema,
  confirmPasswordResetSchema,
  confirmEmailSchema,
  qrApproveSchema,
  passkeyRegisterSchema,
  passkeyLoginSchema,
} from "./schemas.js";
import { AuthService } from "./service.js";
import { config } from "../../config.js";
import { hashIp, resolveSession } from "../../lib/session.js";
import { issueChallenge, verifyRegistrationRequest } from "../../lib/registration-check.js";
import { Errors } from "../../lib/errors.js";
import { SettingsService } from "../settings/service.js";
import { needsTwoFactorSetup } from "../../lib/admin-two-factor.js";
import { QR_PENDING_SECONDS, QrLoginService } from "./qr-login.js";
import { PasskeyService } from "./passkeys.js";

type SerializableUser = {
  id: string;
  username: string;
  email: string | null;
  role: string;
  twoFactorEnabled: boolean;
  canUploadFiles: boolean;
};

function serializeUser(
  user: SerializableUser,
  canMintApiKeys: boolean,
  twoFactorSetupRequired: boolean,
  sessionTemporary = false,
  picture: { avatarUrl: string | null; avatarFrame: string | null } | null = null,
) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    twoFactorEnabled: user.twoFactorEnabled,
    // The editor uses this to decide between an upload box and a
    // "link to a file hosted elsewhere" field, so it is the *effective*
    // permission — the same rule `requireUploadPrivilege` enforces. An
    // administrator may always upload; reporting the bare flag hid the
    // attachment box from the one account the server never refuses.
    canUploadFiles: user.canUploadFiles || user.role === "ADMIN",
    // An administrator without a second factor: the web app shows the
    // set-up screen, QR code first, in place of every page until it is on.
    twoFactorSetupRequired,
    // Signed in only until the browser closes; the web app keeps it alive
    // while a tab is open and says so on the page.
    sessionTemporary,
    // Whether POST /tokens would be accepted — so the dashboard can offer
    // the one API entry that applies to this account instead of listing
    // both "request access" and "mint a key" to everyone.
    canMintApiKeys,
    // The header draws the account as its own picture, in its frame.
    avatarUrl: picture?.avatarUrl ?? null,
    avatarFrame: picture?.avatarFrame ?? null,
  };
}

/** The same rule POST /tokens enforces: an administrator is the operator
 * the contribution is sent to, and anyone else needs an approved request. */
async function canMintApiKeys(app: FastifyInstance, user: { id: string; role: string }): Promise<boolean> {
  if (user.role === "ADMIN") return true;
  if (await new SettingsService(app.prisma).isApiAccessFree()) return true;
  const approved = await app.prisma.apiAccessRequest.findFirst({
    where: { userId: user.id, status: "APPROVED" },
    select: { id: true },
  });
  return approved !== null;
}

/** The signed-in account as the web app reads it. */
async function describeUser(app: FastifyInstance, user: SerializableUser, sessionTemporary = false) {
  // Every page asks this (/auth/me): the three reads go out together.
  const [mint, setup, picture] = await Promise.all([
    canMintApiKeys(app, user),
    needsTwoFactorSetup(app.prisma, user),
    app.prisma.creatorProfile.findUnique({ where: { userId: user.id }, select: { avatarUrl: true, avatarFrame: true } }),
  ]);
  return serializeUser(user, mint, setup, sessionTemporary, picture);
}

export default async function authRoutes(app: FastifyInstance) {
  const service = new AuthService(app.prisma, app.redis);

  // A temporary session's cookie has no expiry: the browser drops it when
  // it closes. Its server-side lifetime is a few minutes, renewed by use.
  const setCookie = (reply: import("fastify").FastifyReply, token: string, expiresAt: Date, ephemeral = false) => {
    reply.setCookie(config.sessionCookieName, token, {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: "lax",
      path: "/",
      ...(ephemeral ? {} : { expires: expiresAt }),
    });
  };

  // What the sign-up page asks for. Public and cheap: the page needs it
  // before anyone has an account.
  app.get("/auth/registration", async (_request, reply) => {
    reply.send({ mode: (await new SettingsService(app.prisma).isRegistrationOpen()) ? "open" : "invite" });
  });

  // Hidden from the API reference: an account is made in a browser on this
  // site, never by a script (lib/registration-check.ts).
  app.get("/auth/register/challenge", { schema: { hide: true } }, async (_request, reply) => {
    reply.header("Cache-Control", "no-store").send({ challenge: await issueChallenge(app.redis, new SettingsService(app.prisma)) });
  });

  app.post("/auth/register", { schema: { hide: true } }, async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    await verifyRegistrationRequest(request, app.redis, request.body, new SettingsService(app.prisma));

    const meta = { userAgent: request.headers["user-agent"], ipHash: hashIp(request.ip) };
    const { user, session } = await service.register(parsed.data, meta);
    setCookie(reply, session.token, session.expiresAt);
    reply.code(201).send({ user: await describeUser(app, user) });
  });

  // Unauthenticated by necessity — whoever needs this cannot sign in.
  // It is one of the auth routes server.ts gives the tighter rate
  // limit, which is what stops it being used to spray an address list.
  app.post("/auth/password-reset/request", async (request, reply) => {
    const parsed = requestPasswordResetSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("Enter the email address on your account.");
    await service.requestPasswordReset(parsed.data.email);
    // Deliberately the same answer whether or not that address exists.
    reply.send({ ok: true });
  });

  app.post("/auth/password-reset/confirm", async (request, reply) => {
    const parsed = confirmPasswordResetSchema.safeParse(request.body);
    if (!parsed.success) {
      throw Errors.validation(parsed.error.issues[0]?.message ?? "Choose a password of at least 10 characters.");
    }
    await service.confirmPasswordReset(parsed.data.token, parsed.data.password);
    reply.send({ ok: true });
  });

  app.post("/auth/email/verify/request", async (request, reply) => {
    const user = await app.requireAuth(request);
    await service.requestEmailVerification(user.id);
    reply.send({ ok: true });
  });

  app.post("/auth/email/verify/confirm", async (request, reply) => {
    const parsed = confirmEmailSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("That confirmation link is invalid.");
    await service.confirmEmailVerification(parsed.data.token);
    reply.send({ ok: true });
  });

  app.post("/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("Please provide your username/email and password.");

    const meta = { userAgent: request.headers["user-agent"], ipHash: hashIp(request.ip) };
    const { user, session } = await service.login(parsed.data, meta);
    setCookie(reply, session.token, session.expiresAt);
    reply.send({ user: await describeUser(app, user) });
  });

  app.post("/auth/logout", async (request, reply) => {
    const token = request.cookies[config.sessionCookieName];
    if (token) await service.logout(token);
    reply.clearCookie(config.sessionCookieName, { path: "/" });
    reply.send({ ok: true });
  });

  /**
   * The browser session making this request, for the routes that manage
   * sign-ins. Cookie-only: a scripted token has no business reading where
   * the person signs in from, let alone signing their devices out — so an
   * API token gets 403 here even though it passes `requireAuth`.
   */
  async function requireBrowserSession(request: FastifyRequest) {
    const user = await app.requireAuth(request);
    const token = request.cookies[config.sessionCookieName];
    const session = token ? await resolveSession(app.prisma, token) : null;
    if (!token || !session || session.userId !== user.id) throw Errors.forbidden();
    return { user, token, session };
  }

  app.get("/auth/sessions", async (request, reply) => {
    const { user, token } = await requireBrowserSession(request);
    reply.send({ sessions: await service.loginHistory(user.id, token) });
  });

  // Signs one device out. Ending the session this request came from is
  // signing out here, so the cookie goes too.
  app.delete("/auth/sessions/:id", async (request, reply) => {
    const { user, session } = await requireBrowserSession(request);
    const { id } = request.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) throw Errors.notFound("Session");
    await service.endSession(user.id, id);
    const current = id === session.id;
    if (current) reply.clearCookie(config.sessionCookieName, { path: "/" });
    reply.send({ ok: true, current });
  });

  app.post("/auth/sessions/end-others", async (request, reply) => {
    const { user, session } = await requireBrowserSession(request);
    reply.send({ ended: await service.endOtherSessions(user.id, session.id) });
  });

  // ---- Signing a computer in from a signed-in phone (qr-login.ts) ----
  const qr = new QrLoginService(app.prisma, app.redis);
  const qrCookie = (id: string) => `platform_qr_${id}`;

  // The computer asks. Its secret goes into a cookie only it holds.
  app.post("/auth/qr/start", async (request, reply) => {
    const started = await qr.start(request.headers["user-agent"]);
    reply.setCookie(qrCookie(started.id), started.secret, {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: "lax",
      path: "/",
      maxAge: QR_PENDING_SECONDS + 60,
    });
    reply.code(201).send({ id: started.id, number: started.number, expiresAt: started.expiresAt });
  });

  // The phone: which device is asking, and the numbers to choose from.
  app.get("/auth/qr/:id", async (request, reply) => {
    await requireBrowserSession(request);
    const { id } = request.params as { id: string };
    reply.header("Cache-Control", "no-store");
    reply.send(await qr.describe(id));
  });

  app.post("/auth/qr/:id/approve", async (request, reply) => {
    const { user } = await requireBrowserSession(request);
    const { id } = request.params as { id: string };
    const parsed = qrApproveSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("Choose the number shown on the computer.");
    await qr.approve(id, user.id, parsed.data.number, parsed.data.temporary);
    reply.send({ ok: true });
  });

  app.post("/auth/qr/:id/reject", async (request, reply) => {
    await requireBrowserSession(request);
    const { id } = request.params as { id: string };
    await qr.reject(id);
    reply.send({ ok: true });
  });

  // The computer, every couple of seconds: has the phone answered?
  app.get("/auth/qr/:id/status", async (request, reply) => {
    const { id } = request.params as { id: string };
    reply.header("Cache-Control", "no-store");
    reply.send({ status: await qr.status(id, request.cookies[qrCookie(id)]) });
  });

  // …and once it has: the session, to this browser only, once.
  app.post("/auth/qr/:id/claim", async (request, reply) => {
    const { id } = request.params as { id: string };
    const meta = { userAgent: request.headers["user-agent"], ipHash: hashIp(request.ip) };
    const { user, session } = await qr.claim(id, request.cookies[qrCookie(id)], meta);
    reply.clearCookie(qrCookie(id), { path: "/" });
    setCookie(reply, session.token, session.expiresAt, session.ephemeral);
    reply.send({ user: await describeUser(app, user, session.ephemeral) });
  });

  // ---- Passkeys: the device's fingerprint, face or PIN (passkeys.ts) ----
  const passkeys = new PasskeyService(app.prisma, app.redis);

  app.get("/auth/passkeys", async (request, reply) => {
    const { user } = await requireBrowserSession(request);
    reply.send({ passkeys: await passkeys.list(user.id) });
  });

  app.post("/auth/passkeys/register/options", async (request, reply) => {
    const { user } = await requireBrowserSession(request);
    reply.send(await passkeys.registrationOptions(user));
  });

  app.post("/auth/passkeys/register", async (request, reply) => {
    const { user } = await requireBrowserSession(request);
    const parsed = passkeyRegisterSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("That passkey response is not valid.");
    reply.code(201).send({ passkey: await passkeys.register(user.id, parsed.data, request.headers["user-agent"]) });
  });

  app.delete("/auth/passkeys/:id", async (request, reply) => {
    const { user } = await requireBrowserSession(request);
    const { id } = request.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) throw Errors.notFound("Passkey");
    await passkeys.remove(user.id, id);
    reply.send({ ok: true });
  });

  // Signing in: no username — the device offers the passkeys it has here.
  app.post("/auth/passkeys/login/options", async (_request, reply) => {
    reply.send(await passkeys.loginOptions());
  });

  app.post("/auth/passkeys/login", async (request, reply) => {
    const parsed = passkeyLoginSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("That passkey response is not valid.");
    const meta = { userAgent: request.headers["user-agent"], ipHash: hashIp(request.ip) };
    const { user, session } = await passkeys.login(parsed.data, meta);
    setCookie(reply, session.token, session.expiresAt);
    reply.send({ user: await describeUser(app, user) });
  });

  app.get("/auth/me", async (request, reply) => {
    if (!request.currentUser) return reply.send({ user: null });
    reply.send({
      user: await describeUser(app, request.currentUser, request.currentSession?.ephemeral ?? false),
    });
  });

  app.post("/auth/2fa/setup", async (request, reply) => {
    const user = await app.requireAuth(request);
    const result = await service.setup2fa(user.id, user.username);
    reply.send(result);
  });

  app.post("/auth/2fa/verify", async (request, reply) => {
    const user = await app.requireAuth(request);
    const parsed = verify2faSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("A valid 6-digit code is required.");
    await service.verify2fa(user.id, parsed.data.code);
    reply.send({ ok: true });
  });

  app.post("/auth/2fa/disable", async (request, reply) => {
    const user = await app.requireAuth(request);
    const parsed = disable2faSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("Your password and a current 2FA code are required.");
    await service.disable2fa(user.id, parsed.data.password, parsed.data.code);
    reply.send({ ok: true });
  });
}
