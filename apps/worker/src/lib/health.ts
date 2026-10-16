import { createServer } from "node:http";

let lastTick = 0;

/** A job loop came round: whatever it found to do, the worker is alive. */
export function markTick(): void {
  lastTick = Date.now();
}

/**
 * GET /health for the status page (apps/status): whether a job loop has
 * come round in the last two minutes. On the compose network only — the
 * port is not published.
 */
export function serveHealth(port: number): void {
  createServer((request, response) => {
    if (request.url !== "/health") {
      response.writeHead(404).end();
      return;
    }
    const age = lastTick ? Date.now() - lastTick : null;
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ ok: age !== null && age < 120_000, lastTickSecondsAgo: age === null ? null : Math.round(age / 1000) }));
  })
    .on("error", (err) => console.warn(`[worker] health port ${port} unavailable: ${err.message}`))
    .listen(port, "0.0.0.0");
}
