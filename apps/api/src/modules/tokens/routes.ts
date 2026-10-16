import type { FastifyInstance } from "fastify";
import { createTokenSchema } from "./schemas.js";
import { TokenService } from "./service.js";
import { Errors } from "../../lib/errors.js";
import { SettingsService } from "../settings/service.js";

export default async function tokenRoutes(app: FastifyInstance) {
  const service = new TokenService(app.prisma);
  const settings = new SettingsService(app.prisma);

  // Minting a key is not self-serve: running the API costs the operator
  // money, so a key is issued by an administrator confirming a
  // contribution (see modules/api-access). A user with approved access
  // may mint additional named keys for their own scripts; everyone else
  // is pointed at the request flow rather than silently refused.
  //
  // An administrator is exempt, because the rule does not describe them:
  // they *are* the operator the contribution is sent to, so requiring one
  // would mean paying themselves and approving their own request just to
  // script against their own server. They can already promote accounts and
  // approve anyone else's request, so no privilege is gained here.
  app.post("/tokens", async (request, reply) => {
    const user = await app.requireAuth(request);
    // The operator decides whether a key costs anything: with API access
    // set to `free`, anyone signed in mints their own, which is what a
    // server run for a small trusted group wants.
    if (user.role !== "ADMIN" && !(await settings.isApiAccessFree())) {
      const approved = await app.prisma.apiAccessRequest.findFirst({
        where: { userId: user.id, status: "APPROVED" },
        select: { id: true },
      });
      if (!approved) {
        throw Errors.forbidden(
          "API access is granted after a contribution — request it from your dashboard first.",
        );
      }
    }
    const parsed = createTokenSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "A token name is required.");
    const result = await service.create(user.id, parsed.data);
    reply.code(201).send(result);
  });

  app.get("/tokens/mine", async (request, reply) => {
    const user = await app.requireAuth(request);
    reply.send({ tokens: await service.listMine(user.id) });
  });

  app.delete("/tokens/:id", async (request, reply) => {
    const user = await app.requireAuth(request);
    const { id } = request.params as { id: string };
    await service.revoke(user.id, id);
    reply.send({ ok: true });
  });
}
