import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { User } from "@platform/db";
import { config } from "../config.js";
import { renewEphemeral, resolveSession } from "../lib/session.js";
import { resolveApiToken } from "../lib/api-token.js";
import { Errors } from "../lib/errors.js";
import { needsTwoFactorSetup } from "../lib/admin-two-factor.js";

export default fp(async function authPlugin(app: FastifyInstance) {
  app.decorateRequest("currentUser", null);
  app.decorateRequest("currentSession", null);

  app.addHook("preHandler", async (request: FastifyRequest) => {
    const cookieToken = request.cookies[config.sessionCookieName];
    if (cookieToken) {
      const session = await resolveSession(app.prisma, cookieToken);
      if (session) {
        request.currentUser = session.user;
        request.currentSession = { id: session.id, ephemeral: session.ephemeral, method: session.method };
        await renewEphemeral(app.prisma, session);
        return;
      }
    }

    // Personal access token — the "mini-API for automation" a creator's
    // own script authenticates with instead of a browser session.
    //
    // Programmatic access is contributed for and granted by an
    // administrator, and that grant can be withdrawn. Checking it here
    // rather than at each route means revoking access takes effect on the
    // next request everywhere at once, including on keys minted before
    // the revocation.
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const apiToken = await resolveApiToken(app.prisma, authHeader.slice("Bearer ".length));
      if (apiToken) {
        const approved = await app.prisma.apiAccessRequest.findFirst({
          where: { userId: apiToken.userId, status: "APPROVED" },
          select: { id: true },
        });
        if (approved) request.currentUser = apiToken.user;
      }
    }
  });

  app.decorate("requireAuth", async (request: FastifyRequest) => {
    if (!request.currentUser) throw Errors.unauthorized();
    return request.currentUser;
  });

  // Admin routes get their own check rather than relying on the frontend
  // to hide a link (spec rule #136 — admin surfaces are separately
  // authorized, not just visually gated).
  app.decorate("requireAdmin", async (request: FastifyRequest) => {
    if (!request.currentUser) throw Errors.unauthorized();
    if (request.currentUser.role !== "ADMIN") throw Errors.forbidden();
    // A password alone never opens the admin area.
    if (await needsTwoFactorSetup(app.prisma, request.currentUser)) throw Errors.adminTwoFactorRequired();
    return request.currentUser;
  });
});

declare module "fastify" {
  interface FastifyRequest {
    currentUser: User | null;
    /** The browser session behind `currentUser`; null for an API token. */
    currentSession: { id: string; ephemeral: boolean; method: string } | null;
  }
  interface FastifyInstance {
    requireAuth: (request: FastifyRequest) => Promise<User>;
    requireAdmin: (request: FastifyRequest) => Promise<User>;
  }
}
