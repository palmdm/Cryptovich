import type { FastifyInstance } from "fastify";
import { AnalyticsService, type AnalyticsPeriod } from "./service.js";
import { Errors } from "../../lib/errors.js";

const VALID_PERIODS = new Set<AnalyticsPeriod>(["7d", "30d", "90d", "1y", "all"]);

export default async function analyticsRoutes(app: FastifyInstance) {
  const service = new AnalyticsService(app.prisma);

  app.get("/analytics/overview", async (request, reply) => {
    const user = await app.requireAuth(request);
    const query = request.query as { period?: string };
    const period = (query.period ?? "30d") as AnalyticsPeriod;
    if (!VALID_PERIODS.has(period)) throw Errors.validation("Invalid period.");
    reply.send(await service.getOverview(user.id, period));
  });
}
