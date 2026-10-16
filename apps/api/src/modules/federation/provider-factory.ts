import { ActivityPubProvider, type FederationProvider } from "@platform/integrations";
import type { FederationInstance } from "@platform/db";

/**
 * Every allowlisted platform value (MASTODON/SHARKEY/ACTIVITYPUB) speaks
 * the same wire protocol, so they all resolve to the same
 * ActivityPubProvider — there's no per-platform special-casing needed
 * the way there is for the sticker providers.
 */
export function resolveFederationProvider(
  instance: FederationInstance,
  actor: { actorId: string; privateKeyPem: string },
): FederationProvider {
  return new ActivityPubProvider(instance.domain, actor.actorId, actor.privateKeyPem);
}
