import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PaymentService } from "./service.js";
import { Errors } from "../../lib/errors.js";

const checkoutSchema = z.object({ productId: z.string().uuid() });

export default async function paymentRoutes(app: FastifyInstance) {
  const service = new PaymentService(app.prisma);

  app.post("/payments/checkout", async (request, reply) => {
    const user = await app.requireAuth(request);
    const parsed = checkoutSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("A valid product is required.");
    const result = await service.startProductCheckout(user.id, parsed.data.productId);
    reply.code(201).send(result);
  });

  // The creator's "pending confirmations" dashboard feed — everything
  // awaiting their manual/external confirm or reject.
  app.get("/payments/pending", async (request, reply) => {
    const user = await app.requireAuth(request);
    const items = await service.listPendingForCreator(user.id);
    reply.send({ items });
  });

  // No auth required: a no-registration donation's payment id is itself
  // the anonymous payer's capability token (see PaymentService.getStatus).
  app.get("/payments/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const payment = await service.getStatus(request.currentUser?.id ?? null, id);
    reply.send({ payment });
  });

  // Informational "I've sent it" flag from the payer — no auth required
  // for the same reason as GET above. Never authoritative on its own.
  // The payer's "I've sent it". Signed in, only for their own payment; an
  // anonymous tip has no payer to check, and its id — known only to the
  // browser that started it — is what marks it.
  app.post("/payments/:id/mark-paid", async (request, reply) => {
    const { id } = request.params as { id: string };
    const payment = await service.markAsPaid(id, request.currentUser?.id ?? null);
    reply.send({ payment });
  });

  // The RECIPIENT (creator) confirming/rejecting receipt themselves — the
  // production-safe, trust-based alternative to the dev-only endpoint
  // below, and the only way a manual (non-crypto) payment ever completes.
  app.post("/payments/:id/confirm", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    const result = await service.confirm(user.id, id);
    reply.send(result);
  });

  app.post("/payments/:id/reject", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    const result = await service.reject(user.id, id);
    reply.send(result);
  });

}
