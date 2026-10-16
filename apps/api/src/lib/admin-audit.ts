import type { FastifyInstance } from "fastify";
import type { Prisma } from "@platform/db";
import { logAdminAction } from "./audit-log.js";

/**
 * Every change an administrator makes through the admin API is in the
 * audit log (spec rule #86). Some handlers write their own entry, with a
 * name and details only they know; for the rest this does it from the
 * route: what was done, to what (the route's ids), and the few fields of
 * the request that say how — never a whole body, which can hold a code or
 * a secret.
 */
type Rule = { action: string; target: string; body?: string[] };

const ROUTES: Record<string, Rule> = {
  "PATCH /admin/settings": { action: "SETTINGS_CHANGED", target: "ServerSetting", body: ["apiAccessMode", "federationEnabled", "registrationMode"] },
  "PATCH /admin/users/:id/uploads": { action: "USER_UPLOADS_CHANGED", target: "User", body: ["allowed"] },
  "POST /admin/products/:id/disable": { action: "PRODUCT_DISABLED", target: "Product" },
  "POST /admin/products/:id/enable": { action: "PRODUCT_ENABLED", target: "Product" },
  "POST /admin/api-access/:id/review": { action: "API_ACCESS_REVIEWED", target: "ApiAccessRequest", body: ["decision"] },
  "POST /admin/api-access/:id/revoke": { action: "API_ACCESS_REVOKED", target: "ApiAccessRequest" },
  "POST /admin/invites": { action: "INVITE_CREATED", target: "InviteCode", body: ["maxUses", "expiresInDays", "note"] },
  "POST /admin/invites/:id/revoke": { action: "INVITE_REVOKED", target: "InviteCode" },
  "PATCH /admin/emoji/:id": { action: "EMOJI_UPDATED", target: "ServerEmoji", body: ["shortcode", "category"] },
  "PATCH /admin/federation/creators/:username": { action: "FEDERATION_AUTHOR_CHANGED", target: "Creator", body: ["enabled"] },
  "PATCH /admin/federation/creators/:username/settings": { action: "FEDERATION_SETTINGS_CHANGED", target: "Creator", body: ["enabled", "autoPublish"] },
  "POST /admin/federation/creators/:username/instances": { action: "FEDERATION_INSTANCE_ADDED", target: "Creator", body: ["domain", "platform"] },
  "DELETE /admin/federation/creators/:username/instances/:id": { action: "FEDERATION_INSTANCE_REMOVED", target: "Creator" },
  "POST /admin/federation/creators/:username/posts/:productId/publish": { action: "FEDERATION_POST_PUBLISHED", target: "Product" },
  "POST /admin/federation/creators/:username/posts/:productId/retract": { action: "FEDERATION_POST_RETRACTED", target: "Product" },
  // Security events in their own right; the code itself is never kept.
  "POST /admin/parameters/unlock": { action: "PARAMETERS_UNLOCKED", target: "Parameters" },
  "POST /admin/parameters/lock": { action: "PARAMETERS_LOCKED", target: "Parameters" },
};

export function recordAdminChanges(app: FastifyInstance): void {
  app.addHook("onResponse", async (request, reply) => {
    if (request.method === "GET" || reply.statusCode >= 400) return;
    const pattern = request.routeOptions?.url;
    if (!pattern?.startsWith("/admin")) return;
    const rule = ROUTES[`${request.method} ${pattern}`];
    const actor = request.currentUser;
    if (!rule || !actor) return;
    const params = (request.params ?? {}) as Record<string, string>;
    const body = (request.body && typeof request.body === "object" ? request.body : {}) as Record<string, unknown>;
    const details: Record<string, unknown> = { ...params };
    for (const field of rule.body ?? []) if (field in body) details[field] = body[field];
    const targetId = params.productId ?? params.id ?? params.username ?? "";
    try {
      await logAdminAction(app.prisma, actor.id, rule.action, rule.target, targetId, details as Prisma.InputJsonValue);
    } catch (err) {
      request.log.warn({ err }, "could not write the audit log");
    }
  });
}
