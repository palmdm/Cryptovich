import { existsSync, readdirSync } from "node:fs";
import type { FastifyDynamicSwaggerOptions } from "@fastify/swagger";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodTypeAny } from "zod";
import { config } from "../config.js";

/**
 * The API reference at /docs, generated from the routes that are actually
 * registered — so it lists every endpoint there is, and none that is gone.
 *
 * The hand-written document it replaced covered a slice of the API and
 * fell further behind with every module added. Routes here validate with
 * zod inside the handler rather than through Fastify's `schema` option, so
 * what a route expects is read from the handler itself:
 *
 *  - the request body is the zod schema it parses (`xSchema.safeParse(
 *    request.body)`), looked up among every module's `schemas.ts` exports
 *    and converted to JSON Schema;
 *  - query parameters are the names it destructures from `request.query`;
 *  - who may call it is the guard it calls (`requireAuth`, `requireAdmin`,
 *    `requireBrowserSession`, or none);
 *  - the success status is the `reply.code(...)` it sends, else 200.
 *
 * All of this only describes; nothing here changes how a request is
 * handled. Prose — summaries, descriptions, response shapes — still comes
 * from `openapi.ts`, laid over the generated entry wherever the same
 * method and path are documented there.
 */

type ModuleSchemas = Map<string, { module: string; schema: ZodTypeAny }[]>;

/** Every zod schema exported by a module's `schemas.ts`, by export name. */
export async function loadModuleSchemas(): Promise<ModuleSchemas> {
  const modulesDir = new URL("../modules/", import.meta.url);
  const found: ModuleSchemas = new Map();
  for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    // `.js` once built, `.ts` when run from source (tsx, vitest).
    const file = ["schemas.js", "schemas.ts"]
      .map((name) => new URL(`${entry.name}/${name}`, modulesDir))
      .find((url) => existsSync(url));
    if (!file) continue;
    const exported = (await import(file.href)) as Record<string, unknown>;
    for (const [name, value] of Object.entries(exported)) {
      if (!value || typeof (value as ZodTypeAny).safeParse !== "function" || !(value as ZodTypeAny)._def) continue;
      const list = found.get(name) ?? [];
      list.push({ module: entry.name, schema: value as ZodTypeAny });
      found.set(name, list);
    }
  }
  return found;
}

type Guard = "public" | "user" | "admin" | "browser";

export interface RouteReading {
  bodySchema: string | null;
  query: string[];
  guard: Guard;
  optionalUser: boolean;
  successCodes: number[];
}

/** What a handler's own source says about the request it takes. */
export function readHandler(source: string): RouteReading {
  const bodySchema = source.match(/(\w+)\.safeParse\(request\.body\b/)?.[1] ?? null;

  const query = new Set<string>();
  for (const m of source.matchAll(/(?:const|let)\s*\{([^}]+)\}\s*=\s*request\.query/g)) {
    for (const part of m[1]!.split(",")) {
      // `limit: rawLimit` and `cursor = ""` name the parameters `limit` and `cursor`.
      const name = part.split(/[:=]/)[0]!.trim();
      if (/^\w+$/.test(name)) query.add(name);
    }
  }
  for (const m of source.matchAll(/request\.query\.(\w+)/g)) query.add(m[1]!);

  const guard: Guard = /requireAdmin\(request/.test(source)
    ? "admin"
    : /requireBrowserSession\(request/.test(source)
      ? "browser"
      : /requireAuth\(request/.test(source)
        ? "user"
        : "public";

  const successCodes = [...new Set([...source.matchAll(/reply\.(?:code|status)\((2\d\d)\)/g)].map((m) => Number(m[1])))];

  return {
    bodySchema,
    query: [...query],
    guard,
    optionalUser: guard === "public" && /request\.currentUser/.test(source),
    successCodes: successCodes.length > 0 ? successCodes : [200],
  };
}

const TAG_FOR_SEGMENT: Record<string, string> = {
  ".well-known": "Federation",
  nodeinfo: "Federation",
  federation: "Federation",
  avatars: "Creators",
  covers: "Creators",
};

/** `/feed-sources/:id` → "Feed sources". */
function tagFor(url: string): string {
  const segment = url.split("/").filter(Boolean)[0] ?? "root";
  if (TAG_FOR_SEGMENT[segment]) return TAG_FOR_SEGMENT[segment]!;
  const words = segment.replace(/[-_]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const GUARD_NOTE: Record<Guard, string> = {
  public: "",
  user: "Requires a signed-in session or a personal access token.",
  admin: "Administrators only.",
  browser: "Browser session only: call it signed in to Cryptovich in this browser — a token is refused here.",
};

function openapiPath(url: string): string {
  return url.replace(/:(\w+)/g, "{$1}");
}

type OpenApiObject = {
  paths: Record<string, Record<string, Record<string, unknown>>>;
  tags?: { name: string; description?: string }[];
  [key: string]: unknown;
};

/**
 * Lays the hand-written prose over the generated entries. The generated
 * request body wins — it is the schema the handler actually parses, where
 * the hand-written one could be stale — and a hand-written entry for a
 * route that no longer exists is dropped rather than advertised.
 */
function overlay(generated: OpenApiObject, handWritten: OpenApiObject): OpenApiObject {
  const tagBySegment = new Map<string, string>();
  for (const [path, methods] of Object.entries(handWritten.paths)) {
    for (const operation of Object.values(methods)) {
      const tags = operation.tags as string[] | undefined;
      const segment = path.split("/").filter(Boolean)[0];
      if (tags?.[0] && segment && !tagBySegment.has(segment)) tagBySegment.set(segment, tags[0]);
    }
  }

  for (const [path, methods] of Object.entries(generated.paths)) {
    const segment = path.split("/").filter(Boolean)[0] ?? "";
    for (const [method, operation] of Object.entries(methods)) {
      const written = handWritten.paths[path]?.[method];
      if (!written) {
        // Kept beside its documented neighbours rather than under a tag of its own.
        if (tagBySegment.has(segment)) operation.tags = [tagBySegment.get(segment)!];
        continue;
      }
      for (const key of ["summary", "tags", "responses", "security"] as const) {
        if (written[key] !== undefined) operation[key] = written[key];
      }
      if (written.description) {
        operation.description = [written.description, operation.description].filter(Boolean).join("\n\n");
      }
      if (!operation.requestBody && written.requestBody) operation.requestBody = written.requestBody;
      const params = new Map<string, unknown>();
      for (const p of [...((operation.parameters as { name: string; in: string }[]) ?? []), ...((written.parameters as { name: string; in: string }[]) ?? [])]) {
        params.set(`${p.in}:${p.name}`, p);
      }
      if (params.size > 0) operation.parameters = [...params.values()];
    }
  }

  const used = new Set(Object.values(generated.paths).flatMap((m) => Object.values(m).flatMap((o) => (o.tags as string[]) ?? [])));
  const described = new Map((handWritten.tags ?? []).map((t) => [t.name, t]));
  generated.tags = [...used].sort((a, b) => a.localeCompare(b)).map((name) => described.get(name) ?? { name });
  return generated;
}

/** `/api` when the API is served under the site's own `/api` proxy. */
export function publicPathPrefix(): string {
  try {
    return new URL(config.apiPublicUrl).pathname.replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function generatedSwaggerOptions(moduleSchemas: ModuleSchemas, handWritten: OpenApiObject): FastifyDynamicSwaggerOptions {
  const successCodes = new Map<string, number[]>();

  return {
    mode: "dynamic",
    openapi: {
      openapi: "3.0.3",
      info: handWritten.info as never,
      // Where "Try it out" sends requests: the API's public address, the
      // one a script would use — not the localhost the old document named.
      servers: [{ url: config.apiPublicUrl }],
      components: handWritten.components as never,
      security: handWritten.security as never,
    },
    transform: ({ schema, url, route }) => {
      if (schema?.hide || url.startsWith("/docs")) return { schema: { ...schema, hide: true }, url };

      const reading = readHandler(String(route.handler));
      const segment = url.split("/").filter(Boolean)[0];
      const candidates = reading.bodySchema ? moduleSchemas.get(reading.bodySchema) : undefined;
      // Two modules may export the same name; the one the route's own path names wins.
      const body = candidates?.find((c) => c.module === segment)?.schema ?? candidates?.[0]?.schema;

      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) successCodes.set(`${method.toLowerCase()} ${openapiPath(url)}`, reading.successCodes);

      const description = [
        GUARD_NOTE[reading.guard],
        reading.optionalUser ? "Works signed out; a signed-in caller may get more." : "",
      ]
        .filter(Boolean)
        .join(" ");

      return {
        url,
        schema: {
          ...schema,
          tags: [tagFor(url)],
          ...(description ? { description } : {}),
          ...(reading.guard === "public" ? { security: [] } : {}),
          // No token opens these, so none is asked for; the note says why.
          ...(reading.guard === "browser" ? { security: [] } : {}),
          ...(body ? { body: zodToJsonSchema(body, { target: "openApi3", $refStrategy: "none" }) } : {}),
          ...(reading.query.length > 0
            ? {
                querystring: {
                  type: "object",
                  properties: Object.fromEntries(reading.query.map((name) => [name, { type: "string" }])),
                },
              }
            : {}),
        },
      };
    },
    transformObject: (documentObject) => {
      const generated = (documentObject as { openapiObject: OpenApiObject }).openapiObject;
      for (const [path, methods] of Object.entries(generated.paths)) {
        for (const [method, operation] of Object.entries(methods)) {
          const codes = successCodes.get(`${method} ${path}`) ?? [200];
          operation.responses = {
            ...Object.fromEntries(codes.map((code) => [String(code), { description: code === 201 ? "Created" : code === 202 ? "Accepted" : code === 204 ? "No content" : "OK" }])),
            default: { $ref: "#/components/responses/Error" },
          };
        }
      }
      return overlay(generated, handWritten) as never;
    },
  };
}
