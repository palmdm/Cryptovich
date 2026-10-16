import { connect } from "node:net";

/**
 * Probes for the status page — each a plain look from outside, with
 * nothing but Node itself: an HTTP request, a TCP handshake. The status
 * service holds no database password and imports no client library, so
 * what it depends on is as little as what it watches.
 */

export interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  /** An HTTP answer's status, when there was one. */
  status?: number;
  /** An HTTP answer's JSON body, when it had one. */
  body?: unknown;
}

const since = (start: number) => Math.round(performance.now() - start);

/** GET `url`; ok is a 2xx. The body is read (a little of it) as JSON when it is JSON. */
export async function probeHttp(url: string, timeoutMs: number): Promise<ProbeResult> {
  const start = performance.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual", headers: { "user-agent": "cryptovich-status" } });
    const text = (await res.text()).slice(0, 4096);
    let body: unknown;
    if ((res.headers.get("content-type") ?? "").includes("json")) {
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
    }
    return { ok: res.status >= 200 && res.status < 300, latencyMs: since(start), status: res.status, body };
  } catch {
    return { ok: false, latencyMs: since(start) };
  }
}

/** Opens a TCP connection, writes `hello`, and hands what comes back to `check` until it decides. */
function tcpExchange(
  host: string,
  port: number,
  timeoutMs: number,
  hello: (send: (data: Buffer | string) => void) => void,
  check: (received: Buffer) => boolean | null,
): Promise<ProbeResult> {
  const start = performance.now();
  return new Promise((resolve) => {
    let received = Buffer.alloc(0);
    let done = false;
    const socket = connect({ host, port });
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ ok, latencyMs: since(start) });
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("error", () => finish(false));
    socket.once("close", () => finish(false));
    socket.once("connect", () => hello((data) => socket.write(data)));
    socket.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);
      const verdict = check(received);
      if (verdict !== null) finish(verdict);
    });
  });
}

/**
 * Postgres answers an SSLRequest with one byte, 'S' or 'N', before any
 * password is asked — so whether the server is up and taking connections
 * can be told without one.
 */
export function probePostgres(host: string, port: number, timeoutMs: number): Promise<ProbeResult> {
  const sslRequest = Buffer.alloc(8);
  sslRequest.writeInt32BE(8, 0);
  sslRequest.writeInt32BE(80877103, 4);
  return tcpExchange(
    host,
    port,
    timeoutMs,
    (send) => send(sslRequest),
    (got) => (got.length === 0 ? null : got[0] === 0x53 || got[0] === 0x4e),
  );
}

const resp = (...parts: string[]) => `*${parts.length}\r\n${parts.map((p) => `$${Buffer.byteLength(p)}\r\n${p}\r\n`).join("")}`;

/** Redis PING (after AUTH, when the address carries a password): ok is +PONG. */
export function probeRedis(address: string, timeoutMs: number): Promise<ProbeResult> {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return Promise.resolve({ ok: false, latencyMs: 0 });
  }
  const password = decodeURIComponent(url.password);
  const user = decodeURIComponent(url.username);
  return tcpExchange(
    url.hostname,
    Number(url.port || 6379),
    timeoutMs,
    (send) => send((password ? (user ? resp("AUTH", user, password) : resp("AUTH", password)) : "") + resp("PING")),
    (got) => {
      const text = got.toString("latin1");
      if (text.includes("+PONG\r\n")) return true;
      if (text.startsWith("-") || text.includes("\r\n-")) return false;
      return null;
    },
  );
}
