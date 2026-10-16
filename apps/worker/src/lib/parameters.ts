import { prisma } from "@platform/db";
import { effectiveParameter, type ServerParameterKey } from "@platform/shared";

/**
 * A setting as it is in force — saved in the admin area, else its .env
 * variable, else its default — read by the same rules as the API
 * (SERVER_PARAMETERS in @platform/shared). Read per use: these jobs run
 * every few seconds or minutes, and one small query is nothing beside
 * what each of them does.
 */
export async function parameter(key: ServerParameterKey): Promise<string> {
  const row = await prisma.serverSetting.findUnique({ where: { key }, select: { value: true } });
  return effectiveParameter(key, row?.value, process.env).value;
}
