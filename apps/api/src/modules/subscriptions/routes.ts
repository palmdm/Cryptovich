import { uploadRateLimit } from "../../lib/upload-rate-limit.js";
import { readMultipartFile } from "../../lib/multipart.js";
import type { FastifyInstance, FastifyReply } from "fastify";
import { createTierSchema, updateTierSchema, subscribeSchema, createDiscountCodeSchema } from "./schemas.js";
import { TierService } from "./tier-service.js";
import { SubscriptionService } from "./service.js";
import { DiscountCodeService } from "./discount-service.js";
import { PaymentService } from "../payments/service.js";
import { Errors } from "../../lib/errors.js";
import { day, SubscriptionExportService } from "./export.js";

/** Someone's own list, as a download — never kept by a shared cache. */
function sendCsv(reply: FastifyReply, filename: string, body: string) {
  reply
    .header("Content-Type", "text/csv; charset=utf-8")
    .header("Content-Disposition", `attachment; filename="${filename}"`)
    .header("Cache-Control", "private, no-store")
    .send(body);
}

export default async function subscriptionRoutes(app: FastifyInstance) {
  const tiers = new TierService(app.prisma);
  const subscriptions = new SubscriptionService(app.prisma);
  const discountCodes = new DiscountCodeService(app.prisma);
  const payments = new PaymentService(app.prisma);
  const exporter = new SubscriptionExportService(app.prisma);

  app.post("/subscriptions/tiers", async (request, reply) => {
    const user = await app.requireAuth(request);
    const parsed = createTierSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    const tier = await tiers.create(user.id, parsed.data);
    reply.code(201).send({ tier });
  });

  app.patch("/subscriptions/tiers/:id", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    const parsed = updateTierSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    const tier = await tiers.update(user.id, id, parsed.data);
    reply.send({ tier });
  });

  app.post("/subscriptions/tiers/:id/image", { config: { rateLimit: uploadRateLimit } }, async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    const file = await readMultipartFile(request);
    reply.send({ tier: await tiers.setImage(user.id, id, file) });
  });

  app.delete("/subscriptions/tiers/:id/image", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    reply.send({ tier: await tiers.removeImage(user.id, id) });
  });

  app.get("/subscriptions/tiers/mine", async (request, reply) => {
    const user = await app.requireAuth(request);
    reply.send({ tiers: await tiers.listMine(user.id) });
  });

  app.get("/subscriptions/tiers/:username", async (request, reply) => {
    const { username } = request.params as { username: string };
    reply.send({ tiers: await tiers.listPublic(username) });
  });

  app.post("/subscriptions/checkout", async (request, reply) => {
    const user = await app.requireAuth(request);
    const parsed = subscribeSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("A valid subscription tier is required.");
    const result = await payments.startSubscriptionCheckout(user.id, parsed.data.tierId, {
      discountCode: parsed.data.discountCode,
      rewardId: parsed.data.rewardId,
    });
    reply.code(201).send(result);
  });

  app.get("/subscriptions/mine", async (request, reply) => {
    const user = await app.requireAuth(request);
    reply.send({ subscriptions: await subscriptions.listMine(user.id) });
  });

  // The same list as a file: a spreadsheet, or (format=mastodon) a
  // following list a fediverse account imports.
  app.get("/subscriptions/mine/export", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { format = "csv" } = request.query as { format?: string };
    if (format === "mastodon") {
      sendCsv(reply, "following_accounts.csv", await exporter.mineAsFollowing(user.id));
    } else if (format === "csv") {
      sendCsv(reply, `subscriptions-${day(new Date())}.csv`, await exporter.mine(user.id));
    } else {
      throw Errors.validation("format is csv or mastodon.");
    }
  });

  app.get("/subscriptions/subscribers/export", async (request, reply) => {
    const user = await app.requireAuth(request);
    sendCsv(reply, `subscribers-${day(new Date())}.csv`, await exporter.subscribers(user.id));
  });

  // The author's own supporters. Local subscriptions only — see the
  // service; a fediverse follower is not a subscriber.
  app.get("/subscriptions/subscribers", async (request, reply) => {
    const user = await app.requireAuth(request);
    reply.send({ subscribers: await subscriptions.listSubscribers(user.id) });
  });

  app.post("/subscriptions/:id/cancel", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    const subscription = await subscriptions.cancel(user.id, id);
    reply.send({ subscription });
  });

  app.post("/subscriptions/discount-codes", async (request, reply) => {
    const user = await app.requireAuth(request);
    const parsed = createDiscountCodeSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    const code = await discountCodes.create(user.id, parsed.data);
    reply.code(201).send({ discountCode: code });
  });

  app.get("/subscriptions/discount-codes/mine", async (request, reply) => {
    const user = await app.requireAuth(request);
    reply.send({ discountCodes: await discountCodes.listMine(user.id) });
  });

  app.post("/subscriptions/discount-codes/:id/deactivate", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    reply.send({ discountCode: await discountCodes.deactivate(user.id, id) });
  });
}
