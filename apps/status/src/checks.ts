import { probeHttp, probePostgres, probeRedis, type ProbeResult } from "./probes.js";

export type ComponentId = "web" | "api" | "database" | "redis" | "worker";
/** `maintenance` is never a probe's finding: it is a part not working during an announced window (see index.ts). */
export type State = "operational" | "degraded" | "down" | "maintenance";

export const COMPONENTS: readonly ComponentId[] = ["web", "api", "database", "redis", "worker"];

export interface ComponentCheck {
  id: ComponentId;
  state: State;
  /** Shown for what a reader waits on: the site and the API. */
  latencyMs?: number;
}

export interface Targets {
  webUrl: string;
  apiUrl: string;
  workerUrl: string;
  postgres: { host: string; port: number };
  redisUrl: string;
  timeoutMs: number;
}

export interface Probes {
  http: (url: string, timeoutMs: number) => Promise<ProbeResult>;
  postgres: (host: string, port: number, timeoutMs: number) => Promise<ProbeResult>;
  redis: (address: string, timeoutMs: number) => Promise<ProbeResult>;
}

const realProbes: Probes = { http: probeHttp, postgres: probePostgres, redis: probeRedis };

/** Slower than this and a working part counts as having trouble. */
export const SLOW_MS = 2500;

const timed = (result: ProbeResult): State => (!result.ok ? "down" : result.latencyMs > SLOW_MS ? "degraded" : "operational");

/**
 * One round: every part of Cryptovich, looked at in parallel.
 *
 * The database is judged by the API's own query when the API answers (a
 * real SELECT 1), and by a handshake when it does not — so a fallen API
 * does not make a healthy database look gone, and the reverse.
 */
export async function runChecks(targets: Targets, probes: Probes = realProbes): Promise<ComponentCheck[]> {
  const [web, api, postgres, redis, worker] = await Promise.all([
    probes.http(`${targets.webUrl}/healthz`, targets.timeoutMs),
    probes.http(`${targets.apiUrl}/health`, targets.timeoutMs),
    probes.postgres(targets.postgres.host, targets.postgres.port, targets.timeoutMs),
    probes.redis(targets.redisUrl, targets.timeoutMs),
    probes.http(`${targets.workerUrl}/health`, targets.timeoutMs),
  ]);

  const apiBody = (api.status === 200 || api.status === 503) && api.body && typeof api.body === "object" ? (api.body as Record<string, unknown>) : null;
  const apiState: State = !apiBody && !api.ok ? "down" : apiBody?.ok === false ? "degraded" : timed(api);
  const databaseState: State = typeof apiBody?.database === "boolean" ? (apiBody.database ? "operational" : "down") : postgres.ok ? "operational" : "down";
  const workerBody = worker.body && typeof worker.body === "object" ? (worker.body as Record<string, unknown>) : null;
  // Answering but with no job loop come round lately: alive, not working.
  const workerState: State = !worker.ok ? "down" : workerBody?.ok === true ? "operational" : "degraded";

  return [
    { id: "web", state: timed(web), latencyMs: web.ok ? web.latencyMs : undefined },
    { id: "api", state: apiState, latencyMs: api.status ? api.latencyMs : undefined },
    { id: "database", state: databaseState },
    { id: "redis", state: redis.ok ? "operational" : "down" },
    { id: "worker", state: workerState },
  ];
}

const RANK: Record<State, number> = { operational: 0, maintenance: 1, degraded: 2, down: 3 };

export function worst(states: State[]): State {
  return states.reduce<State>((a, b) => (RANK[b] > RANK[a] ? b : a), "operational");
}
