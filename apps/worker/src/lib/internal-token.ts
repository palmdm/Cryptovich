import { randomBytes } from "node:crypto";
import { prisma } from "@platform/db";

const KEY = "internalToken";

/** The secret the worker shows the API (see apps/api/src/lib/internal-token.ts — the same row). */
export async function internalToken(): Promise<string> {
  const row = await prisma.serverSetting.findUnique({ where: { key: KEY } });
  if (row) return row.value;
  await prisma.serverSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: randomBytes(32).toString("base64url") }, update: {} });
  return (await prisma.serverSetting.findUniqueOrThrow({ where: { key: KEY } })).value;
}

/** Where the API is, from the worker: the compose network's address, or this machine in development. */
export function apiInternalUrl(): string {
  return (process.env.API_INTERNAL_URL || `http://127.0.0.1:${process.env.API_PORT ?? 4000}`).replace(/\/$/, "");
}
