import type { FastifyInstance, FastifyRequest } from "fastify";
import { PARAMETERS_EXPORT_FORMAT, SERVER_ONLY_PARAMETERS } from "@platform/shared";
import { config } from "../../config.js";
import { Errors } from "../../lib/errors.js";
import { logAdminAction } from "../../lib/audit-log.js";
import { verifyTotpLimited } from "../../lib/totp-attempts.js";
import { SettingsService } from "../settings/service.js";
import { PasskeyService } from "../auth/passkeys.js";
import { passkeyAssertionSchema } from "../auth/schemas.js";

/** How long one code keeps the page open. */
const UNLOCK_SECONDS = 10 * 60;
const unlockKey = (sessionId: string) => `parameters-unlock:${sessionId}`;

/** What `.env` keeps, shown beside the rest; a secret only says whether it is set. */
function serverOnly() {
  const effective: Record<string, string> = {
    WEB_ORIGIN: config.webOrigin,
    API_PUBLIC_URL: config.apiPublicUrl,
    COOKIE_SECURE: String(config.cookieSecure),
  };
  return SERVER_ONLY_PARAMETERS.map(({ env, reason, secret }) => {
    const value = effective[env] ?? process.env[env] ?? "";
    return { env, reason, secret, set: value !== "", value: secret ? null : value };
  });
}

/**
 * "Редактирование параметров": every setting an administrator may change,
 * in one table, with export and import.
 *
 * Only through the web interface: a browser session — an API token is
 * refused — and not listed in /docs. And only with a fresh two-factor code
 * (good for ten minutes in this browser): an admin session alone must not
 * be enough to read the mail password or switch the 2FA requirement off.
 * An administrator who has no second factor yet is told to set one up.
 */
export default async function parameterRoutes(app: FastifyInstance) {
  const settings = new SettingsService(app.prisma);
  const passkeys = new PasskeyService(app.prisma, app.redis);
  const hasPasskey = async (userId: string) => (await app.prisma.passkey.count({ where: { userId } })) > 0;

  async function adminInBrowser(request: FastifyRequest) {
    const admin = await app.requireAdmin(request);
    if (request.headers.authorization || !request.currentSession) throw Errors.forbidden();
    return { admin, sessionId: request.currentSession.id };
  }

  async function unlocked(request: FastifyRequest) {
    const { admin, sessionId } = await adminInBrowser(request);
    const until = await app.redis.get(unlockKey(sessionId));
    if (!until) throw admin.twoFactorEnabled || (await hasPasskey(admin.id)) ? Errors.parametersLocked() : Errors.twoFactorSetupNeeded();
    return { admin, unlockedUntil: new Date(Number(until)).toISOString() };
  }

  // Which ways in this administrator has: a passkey is offered first.
  app.get("/admin/parameters/unlock", { schema: { hide: true } }, async (request, reply) => {
    const { admin } = await adminInBrowser(request);
    reply.header("Cache-Control", "no-store").send({ passkey: await hasPasskey(admin.id), code: admin.twoFactorEnabled });
  });

  app.post("/admin/parameters/unlock/passkey-options", { schema: { hide: true } }, async (request, reply) => {
    const { admin, sessionId } = await adminInBrowser(request);
    const options = await passkeys.confirmOptions(admin.id, `parameters:${sessionId}`);
    if (!options) throw Errors.notFound("Passkey");
    reply.header("Cache-Control", "no-store").send(options);
  });

  // A fingerprint (the account's own passkey, user-verified) or a code
  // from the authenticator app.
  app.post("/admin/parameters/unlock", { schema: { hide: true } }, async (request, reply) => {
    const { admin, sessionId } = await adminInBrowser(request);
    const body = (request.body ?? {}) as { code?: unknown; passkey?: unknown };
    if (body.passkey !== undefined) {
      const assertion = passkeyAssertionSchema.safeParse(body.passkey);
      if (!assertion.success) throw Errors.validation("That passkey answer is not readable.");
      await passkeys.confirm(admin.id, `parameters:${sessionId}`, assertion.data);
    } else {
      if (!admin.twoFactorEnabled) throw Errors.twoFactorSetupNeeded();
      const { code } = body;
      if (typeof code !== "string" || !/^\d{6}$/.test(code.trim())) throw Errors.invalidTwoFactorCode();
      await verifyTotpLimited(app.redis, admin, code.trim());
    }
    const until = Date.now() + UNLOCK_SECONDS * 1000;
    await app.redis.set(unlockKey(sessionId), String(until), "EX", UNLOCK_SECONDS);
    reply.send({ unlockedUntil: new Date(until).toISOString() });
  });

  app.post("/admin/parameters/lock", { schema: { hide: true } }, async (request, reply) => {
    const { sessionId } = await adminInBrowser(request);
    await app.redis.del(unlockKey(sessionId));
    reply.send({ ok: true });
  });

  app.get("/admin/parameters", { schema: { hide: true } }, async (request, reply) => {
    const { unlockedUntil } = await unlocked(request);
    reply.header("Cache-Control", "no-store").send({ parameters: await settings.parameters(), serverOnly: serverOnly(), unlockedUntil });
  });

  // All or none: one value that does not fit refuses the whole change.
  // `null` for a key forgets the saved value, so it follows .env again.
  app.put("/admin/parameters", { schema: { hide: true } }, async (request, reply) => {
    const { admin } = await unlocked(request);
    const { values } = (request.body ?? {}) as { values?: unknown };
    if (!values || typeof values !== "object" || Array.isArray(values) || Object.keys(values).length === 0) {
      throw Errors.validation("Nothing to change.");
    }
    const changed = await settings.saveParameters(values as Record<string, unknown>);
    // The names only — never a value, which may be a password.
    await logAdminAction(app.prisma, admin.id, "PARAMETERS_CHANGED", "ServerSetting", "parameters", { keys: changed });
    reply.header("Cache-Control", "no-store").send({ parameters: await settings.parameters() });
  });

  app.get("/admin/parameters/export", { schema: { hide: true } }, async (request, reply) => {
    const { admin } = await unlocked(request);
    const { secrets } = request.query as { secrets?: string };
    const includesSecrets = secrets === "true";
    if (includesSecrets) {
      await logAdminAction(app.prisma, admin.id, "PARAMETERS_EXPORTED_WITH_SECRETS", "ServerSetting", "parameters");
    }
    const file = {
      format: PARAMETERS_EXPORT_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      server: config.webOrigin,
      includesSecrets,
      parameters: await settings.exportable(includesSecrets),
    };
    reply
      .header("Content-Type", "application/json; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="cryptovich-parameters-${file.exportedAt.slice(0, 10)}.json"`)
      .header("Cache-Control", "no-store")
      .send(JSON.stringify(file, null, 2));
  });
}
