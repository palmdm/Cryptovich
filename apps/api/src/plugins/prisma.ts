import fp from "fastify-plugin" ;
import type { FastifyInstance } from "fastify";
import { prisma } from "@platform/db";

export default fp(async function prismaPlugin(app: FastifyInstance) {
  app.decorate("prisma", prisma);
  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });
});

declare module "fastify" {
  interface FastifyInstance {
    prisma: typeof prisma;
  }
}
