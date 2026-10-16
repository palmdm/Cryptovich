import { SettingsService } from "../settings/service.js";
import type { FastifyInstance, FastifyReply } from "fastify";
import { becomeCreatorSchema, updateCreatorProfileSchema } from "./schemas.js";
import { CreatorService } from "./service.js";
import { Errors } from "../../lib/errors.js";
import { storageService } from "../../lib/storage.js";
import { readMultipartFile } from "../../lib/multipart.js";
import { EXT_TO_MIME } from "../../lib/image-mime.js";
import { ActivityPubService } from "../activitypub/service.js";
import { uploadRateLimit } from "../../lib/upload-rate-limit.js";

const LOCAL_ONLY_FIELDS: ReadonlySet<string> = new Set(["avatarFrame", "birthDate", "showBirthYear", "city", "country", "spotifyUrl", "hideFromSearch"]);

export default async function creatorRoutes(app: FastifyInstance) {
  const service = new CreatorService(app.prisma);
  const activityPub = new ActivityPubService(app.prisma);

  /**
   * A changed profile is queued for the servers of the author's followers,
   * so a new avatar or header shows up there rather than a day later. It
   * is only a queue row — the worker does the sending — and never allowed
   * to turn saving a profile into a failure.
   */
  async function announceProfileChange(creatorId: string) {
    try {
      await activityPub.enqueueProfileUpdate(creatorId);
    } catch (err) {
      app.log.warn({ err: err instanceof Error ? err.message : String(err) }, "could not queue a profile update");
    }
  }

  app.post("/creators", async (request, reply) => {
    const user = await app.requireAuth(request);
    const parsed = becomeCreatorSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    const profile = await service.becomeCreator(user.id, parsed.data);
    reply.code(201).send({ creatorProfile: profile });
  });

  app.patch("/creators/me", async (request, reply) => {
    const user = await app.requireAuth(request);
    const parsed = updateCreatorProfileSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    const profile = await service.updateProfile(user.id, parsed.data);
    // The frame and the "about" details are shown by this site only;
    // changing them is no news to a follower.
    if (Object.keys(parsed.data).some((key) => !LOCAL_ONLY_FIELDS.has(key))) await announceProfileChange(profile.id);
    reply.send({ creatorProfile: profile });
  });

  // Public: the author directory needs no session at all.
  app.get("/creators", async (_request, reply) => {
    const creators = await service.listPublicCreators();
    reply.send({ creators });
  });

  app.get("/creators/me", async (request, reply) => {
    const user = await app.requireAuth(request);
    const profile = await service.getMyProfile(user.id);
    // What the cabinet's own switches depend on: a server hidden from
    // search engines as a whole, and whether it federates at all.
    const settings = new SettingsService(app.prisma);
    const [hidden, federates] = await Promise.all([settings.parameter("hideFromSearchEngines"), settings.isFederationEnabled()]);
    reply.send({ creatorProfile: profile, server: { hideFromSearchEngines: hidden === "true", federationEnabled: federates } });
  });

  app.get("/creators/:username", async (request, reply) => {
    const { username } = request.params as { username: string };
    const profile = await service.getPublicProfile(username);
    reply.send({ creator: profile });
  });

  app.post("/creators/me/avatar", { config: { rateLimit: uploadRateLimit } }, async (request, reply) => {
    const user = await app.requireAuth(request);
    const file = await readMultipartFile(request);
    const profile = await service.uploadAvatar(user.id, file);
    await announceProfileChange(profile.id);
    reply.send({ creatorProfile: profile });
  });

  app.post("/creators/me/cover", { config: { rateLimit: uploadRateLimit } }, async (request, reply) => {
    const user = await app.requireAuth(request);
    const file = await readMultipartFile(request);
    const profile = await service.uploadCover(user.id, file);
    await announceProfileChange(profile.id);
    reply.send({ creatorProfile: profile });
  });

  app.delete("/creators/me/cover", async (request, reply) => {
    const user = await app.requireAuth(request);
    const profile = await service.removeCover(user.id);
    await announceProfileChange(profile.id);
    reply.send({ creatorProfile: profile });
  });

  // Public and unauthenticated on purpose — an avatar is always public,
  // the same as it would be on any social profile. `key` comes straight
  // from the URL, so it's validated against the exact shape `StorageService
  // .save` produces (a UUID + one allowlisted extension) before it ever
  // touches the filesystem — anything else (e.g. a `..` traversal attempt)
  // is rejected as 404 rather than resolved as a path.
  const IMAGE_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpeg|gif|webp)$/;

  // Avatars and covers are both public profile images held in the same
  // store, so one handler serves both rather than two copies of the
  // path-validation and streaming rules drifting apart.
  async function serveProfileImage(key: string, what: string, reply: FastifyReply) {
    if (!IMAGE_KEY_PATTERN.test(key)) throw Errors.notFound(what);
    const extension = key.split(".").pop()!;
    const mimeType = EXT_TO_MIME[extension]!;
    if (!(await storageService.exists(key))) throw Errors.notFound(what);
    // See the equivalent comment in products/routes.ts's attachment
    // download route — the `return` is required for a streamed response
    // to actually finish sending its bytes. `nosniff` stops a browser from
    // ignoring this declared Content-Type and executing a mislabeled file
    // as something else.
    return reply
      .header("Content-Type", mimeType)
      .header("X-Content-Type-Options", "nosniff")
      // The key is a UUID chosen at upload, so this exact URL can never
      // hold different bytes later: a new avatar is a new key. Without
      // this the browser re-fetched the whole file on every page view —
      // an animated avatar is megabytes, and it dominated the page.
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .send(storageService.readStream(key));
  }

  app.get("/avatars/:key", { logLevel: "warn" }, async (request, reply) => {
    const { key } = request.params as { key: string };
    return serveProfileImage(key, "Avatar", reply);
  });

  app.get("/covers/:key", { logLevel: "warn" }, async (request, reply) => {
    const { key } = request.params as { key: string };
    return serveProfileImage(key, "Cover", reply);
  });
}
