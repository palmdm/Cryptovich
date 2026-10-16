import type { FastifyInstance } from "fastify";
import { toggleReactionSchema } from "./schemas.js";
import { ReactionService } from "./service.js";
import { Errors } from "../../lib/errors.js";
import { ensureReaderKey, reactionViewer } from "../../lib/reader-key.js";

/**
 * Reacting needs no account: a signed-out reader is known by a random
 * cookie (lib/reader-key.ts). Clearing it gives a fresh identity, so the
 * route has a ceiling of its own on top of the per-post cap in the
 * service.
 */
const reactionRateLimit = { max: 40, timeWindow: "1 minute" };

export default async function reactionRoutes(app: FastifyInstance) {
  const service = new ReactionService(app.prisma);

  // Public — reading who reacted with what is the same "anonymous
  // reading keeps working" rule every other listing follows.
  app.get("/products/:id/reactions", async (request, reply) => {
    const { id } = request.params as { id: string };
    reply.send(await service.summary(id, reactionViewer(request)));
  });

  app.post("/products/:id/reactions", { config: { rateLimit: reactionRateLimit } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = toggleReactionSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    const viewer = reactionViewer(request);
    if (!viewer.userId) viewer.readerKey = ensureReaderKey(request, reply);
    reply.send(await service.toggle(viewer, id, parsed.data.emoji));
  });

  // Public, like the counts it explains: reactions are a public act.
  app.get("/products/:id/reactions/people", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { emoji, offset } = request.query as { emoji?: string; offset?: string };
    reply.send(await service.people(id, { emoji: emoji || undefined, offset: offset ? Number(offset) : 0 }));
  });
}
