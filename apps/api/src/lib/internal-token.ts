import { randomBytes, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@platform/db";

const KEY = "internalToken";

/**
 * The secret the worker shows the API when it asks for something only the
 * API may do (a post published from Telegram). Made once, kept in a
 * ServerSetting row neither admin page lists — both processes read the
 * same database, so there is nothing to configure.
 */
export async function internalToken(prisma: PrismaClient): Promise<string> {
  const row = await prisma.serverSetting.findUnique({ where: { key: KEY } });
  if (row) return row.value;
  const value = randomBytes(32).toString("base64url");
  await prisma.serverSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: {} });
  return (await prisma.serverSetting.findUniqueOrThrow({ where: { key: KEY } })).value;
}

export async function isInternalToken(prisma: PrismaClient, given: string | undefined): Promise<boolean> {
  if (!given) return false;
  const expected = Buffer.from(await internalToken(prisma));
  const actual = Buffer.from(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
