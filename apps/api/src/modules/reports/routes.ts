import type { FastifyInstance } from "fastify";
import { createReportSchema } from "./schemas.js";
import { ReportService } from "./service.js";
import { Errors } from "../../lib/errors.js";

export default async function reportRoutes(app: FastifyInstance) {
  const service = new ReportService(app.prisma);

  app.post("/reports", async (request, reply) => {
    const user = await app.requireAuth(request);
    const parsed = createReportSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues[0]?.message ?? "Invalid input.");
    const { report, created } = await service.file(user.id, parsed.data);
    reply.code(created ? 201 : 200).send({ report: { id: report.id, status: report.status } });
  });
}
