import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { APP_NAME, APP_SLUG, createErrorReporter } from "@platform/shared";
import { reportCrashes, runningVersion } from "@platform/shared/node";
import { COMPONENTS, runChecks, worst, type ComponentId, type State } from "./checks.js";
import { History } from "./history.js";
import type { Snapshot } from "./render.js";
import { statusServer } from "./server.js";

/**
 * The status page, as a service of its own — an outside monitor in the
 * manner of UptimeRobot. It runs beside the gate (deploy/gate), not in
 * Cryptovich's compose project, so `docker compose down` and every update leave
 * it running and saying what is down; the gate (or nginx) sends /status
 * and /status.json straight here.
 *
 * On the host network it knocks on each part where Cryptovich publishes it on
 * this machine's loopback, at the ports .env gives them; STATUS_* names an
 * address outright.
 */
const env = process.env;
const intervalSeconds = Math.max(10, Number(env.STATUS_INTERVAL_SECONDS ?? 30) || 30);
const port = (name: string, fallback: number) => Number(env[name]) || fallback;
const postgres = (env.STATUS_POSTGRES ?? `127.0.0.1:${port("POSTGRES_PORT", 5433)}`).split(":");
const targets = {
  webUrl: (env.STATUS_WEB_URL ?? `http://127.0.0.1:${port("WEB_PORT", 3000)}`).replace(/\/$/, ""),
  apiUrl: (env.STATUS_API_URL ?? `http://127.0.0.1:${port("API_PORT", 4000)}`).replace(/\/$/, ""),
  workerUrl: (env.STATUS_WORKER_URL ?? `http://127.0.0.1:${port("WORKER_HEALTH_PORT", 3006)}`).replace(/\/$/, ""),
  postgres: { host: postgres[0] || "127.0.0.1", port: Number(postgres[1]) || 5433 },
  redisUrl: env.STATUS_REDIS ?? `redis://127.0.0.1:${port("REDIS_PORT", 6380)}`,
  timeoutMs: 5000,
};
// An announced update: scripts/upgrade.sh puts `window` here for the
// switch, and `on` is the "updating" page by hand. While either is there,
// a part that is not working is "maintenance" — shown in blue and left out
// of uptime, the way UptimeRobot treats a maintenance window.
const maintenanceDir = env.STATUS_MAINTENANCE_DIR ?? "../../deploy/maintenance";
const inMaintenance = () => existsSync(join(maintenanceDir, "window")) || existsSync(join(maintenanceDir, "on"));
const dataDir = env.STATUS_DATA_DIR ?? "./data";
const historyFile = join(dataDir, "history.json");
const reporter = createErrorReporter({
  dsn: env.SENTRY_DSN,
  service: "status",
  release: `${APP_SLUG}@${runningVersion()}`,
  environment: env.SENTRY_ENVIRONMENT || (env.NODE_ENV === "production" ? "production" : "development"),
});
reportCrashes(reporter, "status");

let history = new History();
try {
  history = History.fromJSON(JSON.parse(await readFile(historyFile, "utf8")));
} catch {
  // No history yet, or an unreadable one: start a fresh week.
}

const NAMES: Record<ComponentId, string> = { web: "Website", api: "API", database: "Database", redis: "Redis", worker: "Worker" };
let snapshot: Snapshot = { updatedAt: null, overall: null, components: COMPONENTS.map((id) => ({ id, state: "operational" as State, since: Date.now() })) };
let rounds = 0;

async function save() {
  try {
    await mkdir(dataDir, { recursive: true });
    await writeFile(`${historyFile}.tmp`, JSON.stringify(history));
    await rename(`${historyFile}.tmp`, historyFile);
  } catch (err) {
    console.warn(`[status] could not keep history in ${historyFile}: ${err instanceof Error ? err.message : err}`);
  }
}

async function round() {
  const maintenance = inMaintenance();
  const checks = (await runChecks(targets)).map((check) =>
    maintenance && check.state !== "operational" ? { ...check, state: "maintenance" as State, latencyMs: undefined } : check,
  );
  const now = Date.now();
  const previous = new Map(snapshot.components.map((c) => [c.id, c]));
  snapshot = {
    updatedAt: now,
    overall: maintenance ? "maintenance" : worst(checks.map((c) => c.state)),
    components: checks.map((check) => {
      const before = previous.get(check.id);
      const changed = snapshot.updatedAt !== null && before && before.state !== check.state;
      // A part that went down or came back is worth an error report: the
      // one place that can say so when the API itself cannot. An announced
      // update is not news.
      const planned = check.state === "maintenance" || before?.state === "maintenance";
      if (changed && !planned && check.state !== "operational") {
        reporter.captureMessage(`${NAMES[check.id]} is ${check.state}`, check.state === "down" ? "error" : "warning", { tags: { component: check.id } });
      } else if (changed && !planned) {
        reporter.captureMessage(`${NAMES[check.id]} is back`, "info", { tags: { component: check.id } });
      } else if (changed && check.state !== "operational" && check.state !== "maintenance") {
        // Still not working when the update window closed: that is news.
        reporter.captureMessage(`${NAMES[check.id]} is ${check.state} after an update`, "error", { tags: { component: check.id } });
      }
      return { ...check, since: changed || !before || snapshot.updatedAt === null ? now : before.since };
    }),
  };
  for (const check of checks) history.record(check.id, check.state, now);
  rounds += 1;
  if (rounds % 10 === 0) await save();
}

const server = statusServer({ snapshot: () => snapshot, history, intervalSeconds, siteUrl: env.WEB_ORIGIN || null });
// Loopback by default: the gate and nginx are on this machine.
const listenHost = env.STATUS_LISTEN || "127.0.0.1";
server.listen(Number(env.STATUS_PORT ?? 3005), listenHost, () => {
  console.log(`[status] ${APP_NAME} v${runningVersion()} — status page on ${listenHost}:${env.STATUS_PORT ?? 3005}, checking every ${intervalSeconds}s`);
});
void round();
setInterval(() => void round().catch((err) => console.warn("[status] round failed", err)), intervalSeconds * 1000);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void save().finally(() => process.exit(0));
  });
}
