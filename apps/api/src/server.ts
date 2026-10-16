import path from "node:path";
import Fastify from "fastify";
import { APP_NAME, SERVER_PARAMETERS } from "@platform/shared";
import { notesFor, runningVersion } from "@platform/shared/node";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { config } from "./config.js";
import { errorReporter, reportCrashes } from "./lib/error-reporter.js";
import type { ErrorReporter } from "@platform/shared";
import { ensureAdmin, reportAdminBootstrap } from "./lib/admin-bootstrap.js";
import { dnsWarnings, federationWarnings, publicUrlWarnings, reportStartupChecks } from "./lib/startup-checks.js";
import { openApiDocument } from "./openapi.js";
import { generatedSwaggerOptions, loadModuleSchemas, publicPathPrefix } from "./lib/openapi-generate.js";
import { AppError } from "./lib/errors.js";
import { recordAdminChanges } from "./lib/admin-audit.js";
import prismaPlugin from "./plugins/prisma.js";
import redisPlugin from "./plugins/redis.js";
import authPlugin from "./plugins/auth.js";
import authRoutes from "./modules/auth/routes.js";
import creatorRoutes from "./modules/creators/routes.js";
import productRoutes from "./modules/products/routes.js";
import bundleRoutes from "./modules/bundles/routes.js";
import storeRoutes from "./modules/store/routes.js";
import searchRoutes from "./modules/search/routes.js";
import paymentRoutes from "./modules/payments/routes.js";
import donationRoutes from "./modules/donations/routes.js";
import subscriptionRoutes from "./modules/subscriptions/routes.js";
import libraryRoutes from "./modules/library/routes.js";
import stickerRoutes from "./modules/stickers/routes.js";
import federationRoutes from "./modules/federation/routes.js";
import analyticsRoutes from "./modules/analytics/routes.js";
import reportRoutes from "./modules/reports/routes.js";
import adminRoutes from "./modules/admin/routes.js";
import parameterRoutes from "./modules/parameters/routes.js";
import commentRoutes from "./modules/comments/routes.js";
import reactionRoutes from "./modules/reactions/routes.js";
import engagementRoutes from "./modules/engagement/routes.js";
import fundraisingRoutes from "./modules/fundraising/routes.js";
import feedRoutes from "./modules/feed/routes.js";
import folderRoutes from "./modules/folders/routes.js";
import notificationRoutes from "./modules/notifications/routes.js";
import feedSourceRoutes from "./modules/feed-sources/routes.js";
import inviteRoutes from "./modules/invites/routes.js";
import walletRoutes from "./modules/wallets/routes.js";
import taxonomyRoutes from "./modules/taxonomy/routes.js";
import digitalFileRoutes from "./modules/digital-files/routes.js";
import emojiRoutes from "./modules/emoji/routes.js";
import apiAccessRoutes from "./modules/api-access/routes.js";
import activityPubRoutes from "./modules/activitypub/routes.js";
import tokenRoutes from "./modules/tokens/routes.js";
import fileRoutes from "./modules/files/routes.js";
import brandingRoutes from "./modules/branding/routes.js";
import pushRoutes from "./modules/push/routes.js";
import announcementRoutes from "./modules/announcements/routes.js";
import { AnnouncementService } from "./modules/announcements/service.js";
import serverEmojiRoutes from "./modules/server-emoji/routes.js";
import previewRoutes from "./modules/previews/routes.js";
import rewardRoutes from "./modules/rewards/routes.js";
import embedRoutes from "./modules/embeds/routes.js";
import followRoutes from "./modules/follows/routes.js";
import shortLinkRoutes from "./modules/short-links/routes.js";
import updateRoutes from "./modules/updates/routes.js";
import telegramRoutes from "./modules/telegram/routes.js";
import type { SpotifyFetchers } from "./modules/embeds/service.js";

// Prisma BigInt columns (money minor units) serialize as native `bigint`.
// JSON.stringify cannot handle bigint by default; every amount is safe to
// render as a decimal string, so we do that once, globally, at the edge.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

/**
 * `federation` lets a test stub the two places inbound federation reaches
 * the network — resolving a signer's key and their inbox — without
 * disabling the SSRF guard that protects both in production.
 */
export interface BuildServerOptions {
  federation?: Parameters<typeof activityPubRoutes>[1];
  /** Where unexpected errors are reported; SENTRY_DSN decides by default. */
  errorReporter?: ErrorReporter;
  /** A test's stand-in for Spotify. */
  embeds?: { spotify?: SpotifyFetchers };
}

const authRateLimit = { max: 10, timeWindow: "1 minute" as const };
/** Stored pictures and files: one shared, generous bucket per address. */
const MEDIA_RATE_LIMIT = { max: 3000, timeWindow: "1 minute", groupId: "media" };
const MEDIA_ROUTES = new Set([
  "/avatars/:key",
  "/covers/:key",
  "/emoji/files/:key",
  "/embeds/spotify/:kind/:id/cover",
  "/products/:id/attachments/:attachmentId/file",
  "/folders/files/:itemId",
]);
const paymentRateLimit = { max: 20, timeWindow: "1 minute" as const };
const externalIntegrationRateLimit = { max: 15, timeWindow: "1 minute" as const };

/**
 * Which routes get a tighter limit than the general one. Reads stay on the
 * general limit: every page asks /auth/me, and a payment page polls its
 * status — ten a minute would lock a reader out of their own session.
 */
const STRICT_ROUTE_LIMITS: { limit: { max: number; timeWindow: string }; applies: (method: string, url: string) => boolean }[] = [
  {
    limit: authRateLimit,
    applies: (method, url) =>
      (url.startsWith("/auth/") && (method !== "GET" || url === "/auth/register/challenge")) ||
      (url.startsWith("/tokens") && method !== "GET"),
  },
  // Money changes, and reports — each one notifies every administrator.
  { limit: paymentRateLimit, applies: (method, url) => method !== "GET" && /^\/(payments|donations|subscriptions|rewards|reports)(\/|$)/.test(url) },
  {
    limit: externalIntegrationRateLimit,
    applies: (method, url) => method !== "GET" && /^\/(feed-sources|admin\/federation|admin\/emoji\/imports)(\/|$)/.test(url),
  },
];

/** On unless switched off — the test suite creates far more accounts a minute than a person does. */
function strictRateLimits(): boolean {
  return process.env.STRICT_RATE_LIMITS !== "false";
}

export async function buildServer(options: BuildServerOptions = {}) {
  const reporter = options.errorReporter ?? errorReporter;
  const app = Fastify({
    logger: {
      level: config.isProduction ? "info" : "debug",
      redact: ["req.headers.cookie", "req.headers.authorization"],
    },
    trustProxy: config.trustProxy,
  });

  await app.register(cors, { origin: config.webOrigin, credentials: true });
  await app.register(cookie);
  // A request that changes something and rides on a cookie must come from
  // the site itself. SameSite=Lax keeps other sites' requests from
  // carrying the cookie, but not a sibling subdomain's — a page on
  // evil.example.nz is the same *site* as cryptovich.example.nz — so the
  // browser's Origin is checked too. A token is never attached by a
  // browser on its own, and a request with no cookie has nothing to forge.
  const ownOrigins = new Set([config.webOrigin, new URL(config.apiPublicUrl).origin]);
  app.addHook("onRequest", async (request, reply) => {
    if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return;
    if (request.headers.authorization || !request.headers.cookie) return;
    const origin = request.headers.origin;
    const site = request.headers["sec-fetch-site"];
    const foreign = origin !== undefined ? !ownOrigins.has(origin) : site === "cross-site" || site === "same-site";
    if (!foreign) return;
    request.log.warn({ origin, site, url: request.url }, "refused a request with this site's cookie from another origin");
    return reply.code(403).send({ error: { code: "FOREIGN_ORIGIN", message: "This request did not come from this site." } });
  });
  // fileSize is set one byte over the real ceiling so an oversized upload
  // gets truncated (detectable via `file.truncated`) instead of silently
  // accepted at exactly the limit, which would otherwise be indistinguishable
  // from a real file that happens to be exactly that size.
  // The real limit is the `maxUploadBytes` setting, applied per request
  // (lib/multipart.ts); this is only the ceiling that setting can reach.
  await app.register(multipart, { limits: { fileSize: SERVER_PARAMETERS.maxUploadBytes.max + 1 } });
  // Tighter limits for the routes worth guessing at — signing in,
  // recovering an account, paying, reaching out to other servers.
  //
  // Assigned here, at the root and before the limiter is registered, because
  // the limiter reads a route's `config.rateLimit` in its own onRoute hook:
  // these used to be set from onRoute hooks inside each group's scope, which
  // run after the root's, so every one of them was silently ignored and
  // signing in was limited to the general 300 a minute.
  if (strictRateLimits()) {
    app.addHook("onRoute", (route) => {
      if (route.config?.rateLimit !== undefined) return;
      const methods = (Array.isArray(route.method) ? route.method : [route.method]).map(String);
      const rule = STRICT_ROUTE_LIMITS.find((r) => methods.some((m) => r.applies(m, route.url)));
      if (rule) route.config = { ...route.config, rateLimit: rule.limit };
    });
  }
  // Pictures and attachment files have a bucket of their own. A page that
  // shows a whole sticker library, or a long post, asks for hundreds of
  // them at once; counted against the general 300 they spent the reader's
  // budget in seconds, and the next /auth/me was refused — which signed
  // an administrator out of the sticker page mid-import.
  app.addHook("onRoute", (route) => {
    if (route.config?.rateLimit !== undefined) return;
    const methods = (Array.isArray(route.method) ? route.method : [route.method]).map(String);
    if (methods.includes("GET") && MEDIA_ROUTES.has(route.url)) route.config = { ...route.config, rateLimit: MEDIA_RATE_LIMIT };
  });
  // Defense in depth (spec rule #108): every route gets this ceiling even
  // if no tighter per-route limit applies.
  await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });
  // Response hardening for the API itself. The API serves JSON and user
  // uploads, never markup that should be framed or sniffed — an uploaded
  // file that a browser guesses is HTML would run in this origin, which
  // is the whole reason `nosniff` is here as well as on the download
  // routes. `frame-ancestors 'none'` is the CSP form of X-Frame-Options
  // and applies to the Swagger UI at /docs too.
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    // Data, not pages: a search engine that followed an /api link would
    // list raw JSON — with an author's posts in it, whatever the author
    // chose for their pages.
    if (/json/.test(String(reply.getHeader("content-type") ?? ""))) reply.header("X-Robots-Tag", "noindex");

    // The interactive API docs are the one thing this server serves that
    // is meant to be a page: it needs its own scripts and styles, so the
    // lockdown policy below would blank it. It still gets nosniff and the
    // framing headers above.
    if (!request.url.startsWith("/docs")) {
      // Everything else is JSON or a user-uploaded file. `sandbox` denies
      // the response its own origin, so a file a browser guesses is HTML
      // cannot reach cookies or call this API even if it does render.
      reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; sandbox");
    }
    return payload;
  });

  await app.register(prismaPlugin);
  await app.register(redisPlugin);
  await app.register(authPlugin);
  // After auth: it reads who did it.
  recordAdminChanges(app);
  // The reference at /docs is generated from the registered routes
  // (lib/openapi-generate.ts), with openapi.ts's prose laid over it.
  await app.register(swagger, generatedSwaggerOptions(await loadModuleSchemas(), openApiDocument as never));
  // Behind the site's /api proxy the page must ask for its scripts and
  // styles at /api/docs/static/..., not /docs/static/... — the bare path
  // reached the web app instead, and the page came up blank.
  await app.register(swaggerUi, { routePrefix: "/docs", indexPrefix: publicPathPrefix() });

  // Registered before any route so plugins that wrap per-route error
  // handling (like @fastify/rate-limit's per-route `config.rateLimit`,
  // applied via an `onRoute` hook that fires at route-definition time)
  // pick up this handler instead of Fastify's default — setting it after
  // routes exist is too late for those routes.
  const uploadRoot = path.resolve(config.uploadDir);
  app.setErrorHandler((error, request, reply) => {
    // A file route sets its type, length and (for avatars) a year-long
    // cache before the bytes start; a failure there is answered in JSON,
    // and an answer that is an error is never cached. Left as they were,
    // the JSON body could not be sent at all ("payload of invalid type")
    // and a browser would keep a 404 for a year.
    if (!reply.raw.headersSent) {
      reply.removeHeader("content-length");
      reply.removeHeader("content-disposition");
      reply.header("Cache-Control", "no-store");
      reply.type("application/json; charset=utf-8");
    }
    // A stored file that is no longer there — lost from the upload
    // directory or the bucket: that file is gone, the server is not broken.
    const missing = error as { code?: string; name?: string; path?: string };
    if ((missing.code === "ENOENT" && missing.path?.startsWith(uploadRoot + path.sep)) || missing.name === "NoSuchKey") {
      request.log.warn({ route: request.routeOptions?.url }, "a stored file is missing");
      reply.code(404).send({ error: { code: "NOT_FOUND", message: "This file could not be found." } });
      return;
    }
    if (error instanceof AppError) {
      reply.code(error.statusCode).send({ error: { code: error.code, message: error.userMessage } });
      return;
    }
    if ((error as { validation?: unknown }).validation) {
      reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid request." } });
      return;
    }
    // Fastify's own request-parsing errors (malformed/empty JSON body,
    // payload too large, unsupported media type, ...) already carry the
    // right 4xx status and a framework `FST_ERR_*` code — a caller mistake,
    // not a server fault. Without this branch every one of these fell
    // through to the generic 500 below, which is both the wrong status
    // code and, in aggregate, indistinguishable in logs from a real crash.
    // The concrete case that surfaced this: `apiFetch` used to send
    // `Content-Type: application/json` on every request regardless of
    // whether a body was attached, so any bodyless POST/DELETE — logout,
    // publish, cancel, go-live, mark-read, ... — 500'd on FST_ERR_CTP_EMPTY_
    // JSON_BODY. That's fixed at the source in apps/web/lib/api.ts, but this
    // still guards every other way a client can send a malformed request.
    const fastifyCode = (error as { code?: string }).code;
    const fastifyStatus = (error as { statusCode?: number }).statusCode;
    if (typeof fastifyCode === "string" && fastifyCode.startsWith("FST_") && fastifyStatus && fastifyStatus < 500) {
      reply.code(fastifyStatus).send({ error: { code: "VALIDATION_ERROR", message: "Invalid request." } });
      return;
    }
    // Too many requests is the caller's pace, not a fault here. The rate
    // limiter throws a plain Error carrying `statusCode: 429`, which used
    // to fall through to the 500 below: a reader who tripped the limit was
    // then told "something went wrong on our end" by *every* request for
    // the next minute, and the log showed a wall of 500s with no hint that
    // a limit had been reached at all.
    if (fastifyStatus === 429) {
      reply.code(429).send({
        error: { code: "RATE_LIMITED", message: "Too many requests just now. Wait a moment and try again." },
      });
      return;
    }
    request.log.error(error);
    // The route's pattern, never its URL: a path or query can name a person.
    reporter.captureException(error, { tags: { route: request.routeOptions?.url ?? "unmatched", method: request.method } });
    reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "Something went wrong on our end. Please try again." },
    });
  });

  app.get("/health", async () => {
    const [dbOk, redisOk] = await Promise.all([
      app.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      app.redis.ping().then(() => true).catch(() => false),
    ]);
    return { ok: dbOk && redisOk, database: dbOk, redis: redisOk };
  });

  await app.register(authRoutes);
  await app.register(tokenRoutes);
  // ActivityPub, in its own scope with a raw-body parser. An HTTP
  // Signature covers the exact bytes a remote server sent, so parsing to
  // JSON and re-serialising would change them and every signature would
  // fail to verify. The handlers parse the string themselves, after the
  // signature has been checked against it.
  await app.register(async (scope) => {
    scope.addContentTypeParser(
      ["application/activity+json", "application/ld+json", "application/json"],
      { parseAs: "string" },
      (_request, body, done) => done(null, body),
    );
    await activityPubRoutes(scope, options.federation);
  });

  await app.register(creatorRoutes);
  await app.register(productRoutes);
  await app.register(bundleRoutes);
  await app.register(storeRoutes);
  await app.register(searchRoutes);
  await app.register(paymentRoutes);
  await app.register(donationRoutes);
  await app.register(subscriptionRoutes);
  await app.register(libraryRoutes);
  await app.register(analyticsRoutes);
  await app.register(commentRoutes);
  await app.register(reactionRoutes);
  await app.register(engagementRoutes);
  await app.register(fundraisingRoutes);
  await app.register(feedRoutes);
  await app.register(followRoutes);
  await app.register(shortLinkRoutes);
  await app.register(updateRoutes);
  await app.register(telegramRoutes);
  await app.register(folderRoutes);
  await app.register(notificationRoutes);
  await app.register(federationRoutes);
  await app.register(feedSourceRoutes);
  await app.register(stickerRoutes);
  await app.register(reportRoutes);
  await app.register(adminRoutes);
  await app.register(parameterRoutes);
  await app.register(inviteRoutes);
  await app.register(walletRoutes);
  await app.register(taxonomyRoutes);
  await app.register(digitalFileRoutes);
  await app.register(emojiRoutes);
  await app.register(apiAccessRoutes);
  await app.register(fileRoutes);
  await app.register(brandingRoutes);
  await app.register(pushRoutes);
  await app.register(announcementRoutes);
  await app.register(serverEmojiRoutes);
  await app.register(previewRoutes);
  await app.register(rewardRoutes);
  await app.register(embedRoutes, options.embeds ?? {});

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  reportCrashes(errorReporter, "api");
  buildServer()
    .then(async (app) => {
      reportStartupChecks(publicUrlWarnings());
      reportStartupChecks(await federationWarnings(app.prisma).catch(() => []));
      // Before listening, so no registration can race it for "first account".
      reportAdminBootstrap(await ensureAdmin(app.prisma));
      await app.listen({ port: config.port, host: "0.0.0.0" });
      console.log(`${APP_NAME} v${runningVersion()} — API listening on :${config.port}`);
      if (!notesFor(runningVersion())) {
        app.log.warn(`CHANGELOG.md has no "## ${runningVersion()}" section — this version's update announcement will name the version and nothing else`);
      }
      // After listening: a resolver that hangs must not hold up the site.
      void dnsWarnings(config.federationBaseUrl).then(reportStartupChecks);
      // "Cryptovich updated to vX", once per version, for the announcements panel.
      void new AnnouncementService(app.prisma).ensureReleaseAnnouncement(runningVersion()).catch(() => false);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
