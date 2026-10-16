import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { config } from "../config.js";

export default fp(async function redisPlugin(app: FastifyInstance) {
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });
  app.decorate("redis", redis);
  app.addHook("onClose", async () => {
    redis.disconnect();
  });
});

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis;
  }
}
