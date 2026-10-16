import type { FastifyInstance } from "fastify";
import { donationCheckoutSchema } from "./schemas.js";
import { PaymentService } from "../payments/service.js";
import { Errors } from "../../lib/errors.js";

export default async function donationRoutes(app: FastifyInstance) {
  const payments = new PaymentService(app.prisma);

  // No auth required — donations can be sent without registration. A
  // signed-in sender is still recorded (so it can show up in "sent
  // donations" / the public feed under their name); an anonymous one
  // gets `senderUserId: null` and relies on the payment id itself as
  // their capability token to check status afterward.
  app.post("/donations/checkout", async (request, reply) => {
    const parsed = donationCheckoutSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    const result = await payments.startDonationCheckout(request.currentUser?.id ?? null, parsed.data);
    reply.code(201).send(result);
  });

  // Public, opt-in donation feed for a creator's profile (spec rule #42:
  // `isPublic`) — never exposes the sender unless the sender chose to be shown.
  app.get("/donations/public/:username", async (request, reply) => {
    const { username } = request.params as { username: string };
    const creator = await app.prisma.creatorProfile.findFirst({ where: { user: { username } } });
    if (!creator) throw Errors.notFound("Creator");
    if (!creator.showDonations) return reply.send({ donations: [] });

    const donations = await app.prisma.donation.findMany({
      where: { creatorId: creator.id, status: "COMPLETED", isPublic: true },
      include: { sender: { select: { username: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    reply.send({
      donations: donations.map((d) => ({
        id: d.id,
        amountMinor: d.amountMinor.toString(),
        currency: d.currency,
        message: d.message,
        senderUsername: d.sender?.username ?? null,
        createdAt: d.createdAt,
      })),
    });
  });
}
