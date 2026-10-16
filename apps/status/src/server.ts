import { createServer, type Server } from "node:http";
import { pickLang, pickRange, renderHtml, renderJson, type Snapshot } from "./render.js";
import type { History } from "./history.js";

/** Its own page's rules: no script at all, styles and the favicon inline. */
const HEADERS = {
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "public, max-age=15",
};

export function statusServer(state: {
  snapshot: () => Snapshot;
  history: History;
  intervalSeconds: number;
  siteUrl: string | null;
  now?: () => number;
}): Server {
  const now = state.now ?? Date.now;
  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://status");
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    const send = (type: string, body: string) => {
      response.writeHead(200, { ...HEADERS, "Content-Type": type, "Content-Length": Buffer.byteLength(body) });
      response.end(request.method === "HEAD" ? undefined : body);
    };
    if (url.pathname === "/status" || url.pathname === "/status/") {
      const lang = pickLang(url.searchParams.get("lang"), request.headers["accept-language"]);
      const range = pickRange(url.searchParams.get("range"));
      send(
        "text/html; charset=utf-8",
        renderHtml(state.snapshot(), state.history, {
          lang,
          range,
          langInQuery: url.searchParams.has("lang"),
          now: now(),
          intervalSeconds: state.intervalSeconds,
          siteUrl: state.siteUrl,
        }),
      );
    } else if (url.pathname === "/status.json") {
      send("application/json; charset=utf-8", JSON.stringify(renderJson(state.snapshot(), state.history, now())));
    } else if (url.pathname === "/healthz") {
      send("text/plain; charset=utf-8", "ok");
    } else {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
    }
  });
}
