import { prisma } from "@platform/db";
import { generateActorKeyPair, getRequestSigner, type ActorKeyPair, type RequestSigner } from "@platform/integrations";
import { federationBaseFrom, INSTANCE_ACTOR_KEYS_SETTING, instanceActorUriFor } from "@platform/shared";

const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const API_PUBLIC_URL = (process.env.API_PUBLIC_URL ?? WEB_ORIGIN).replace(/\/$/, "");

/**
 * Signs the worker's reads of other servers as this installation's
 * instance actor — the same key the API publishes at `/federation/actor`,
 * so the remote server can check it. A server in authorized-fetch mode
 * answers 401 to an unsigned read of an outbox.
 *
 * The keypair is made by whichever process needs it first; the first
 * write wins and both read back the same row.
 */
export async function instanceSigner(): Promise<RequestSigner> {
  let row = await prisma.serverSetting.findUnique({ where: { key: INSTANCE_ACTOR_KEYS_SETTING } });
  if (!row) {
    await prisma.serverSetting.createMany({
      data: [{ key: INSTANCE_ACTOR_KEYS_SETTING, value: JSON.stringify(generateActorKeyPair()) }],
      skipDuplicates: true,
    });
    row = await prisma.serverSetting.findUniqueOrThrow({ where: { key: INSTANCE_ACTOR_KEYS_SETTING } });
  }
  const keys = JSON.parse(row.value) as ActorKeyPair;
  return getRequestSigner(`${instanceActorUriFor(federationBaseFrom(API_PUBLIC_URL))}#main-key`, keys.privateKeyPem);
}
