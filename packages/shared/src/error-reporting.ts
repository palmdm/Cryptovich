/**
 * Error reports to a Sentry-compatible server — sentry.io, a self-hosted
 * Sentry or GlitchTip: which one is whatever the DSN names. Off unless a
 * DSN is given (SENTRY_DSN), and then only for what goes wrong on the
 * server side: the API, the worker, the web server, the status page.
 *
 * A small client of Sentry's envelope protocol rather than its SDK: one
 * module every process can load (Node and Next's edge runtime alike), no
 * patching of globals, and nothing it does not need. What it sends is the
 * error, its stack and where it happened (the service, a route pattern) —
 * never a reader's address, cookies, email, a query string or what a
 * request carried.
 */

export type ReportLevel = "info" | "warning" | "error" | "fatal";

export interface ReportContext {
  /** Short indexed labels: `route`, `method`, `job`, `component`. */
  tags?: Record<string, string | number | undefined>;
  /** Anything else worth reading beside the error, kept small. */
  extra?: Record<string, unknown>;
}

export interface ErrorReporter {
  readonly enabled: boolean;
  captureException(error: unknown, context?: ReportContext): void;
  captureMessage(message: string, level: ReportLevel, context?: ReportContext): void;
  /** Waits (up to `timeoutMs`) for reports already on their way — before a crash exits. */
  flush(timeoutMs?: number): Promise<void>;
}

export interface ReporterOptions {
  dsn?: string | null;
  /** Which part of Cryptovich this is: "api", "worker", "web", "status". */
  service: string;
  release: string;
  environment?: string;
  fetch?: typeof fetch;
  now?: () => number;
  /** Most reports a minute; past it they are dropped, so a loop of failures cannot flood the server. */
  perMinute?: number;
}

export interface ParsedDsn {
  /** Where envelopes go: `<origin><path>/api/<project>/envelope/`. */
  endpoint: string;
  publicKey: string;
}

/** `https://<key>@<host>[:port][/path]/<project>` — or null for anything else. */
export function parseDsn(dsn: string | null | undefined): ParsedDsn | null {
  if (!dsn?.trim()) return null;
  let url: URL;
  try {
    url = new URL(dsn.trim());
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.username) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  const project = segments.pop();
  if (!project || !/^\d+$/.test(project)) return null;
  const prefix = segments.length > 0 ? `/${segments.join("/")}` : "";
  return { endpoint: `${url.protocol}//${url.host}${prefix}/api/${project}/envelope/`, publicKey: decodeURIComponent(url.username) };
}

export interface StackFrame {
  filename: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}

const V8_FRAME = /^\s*at (?:(?:async )?(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/;

/** V8's stack lines as Sentry's frames — oldest call first, the way Sentry lists them. */
export function parseStack(stack: string | undefined): StackFrame[] {
  if (!stack) return [];
  const frames: StackFrame[] = [];
  for (const line of stack.split("\n").slice(1, 60)) {
    const m = line.match(V8_FRAME);
    if (!m) continue;
    const filename = m[2]!.replace(/^file:\/\//, "");
    frames.push({
      filename,
      ...(m[1] ? { function: m[1] } : {}),
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !filename.includes("node_modules") && !filename.startsWith("node:") && !filename.startsWith("internal/"),
    });
  }
  return frames.reverse();
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** Something JSON can carry, kept small: an extra must never be the size of a request. */
function small(value: unknown): unknown {
  try {
    const json = JSON.stringify(value);
    if (json === undefined) return String(value);
    return json.length > 2000 ? clip(json, 2000) : JSON.parse(json);
  } catch {
    return clip(String(value), 2000);
  }
}

function exceptionValues(error: unknown): { type: string; value: string; stacktrace?: { frames: StackFrame[] } }[] {
  const values = [];
  let current: unknown = error;
  // The error and what caused it, innermost first — Sentry's order.
  for (let depth = 0; current !== undefined && current !== null && depth < 5; depth += 1) {
    if (current instanceof Error) {
      const frames = parseStack(current.stack);
      values.unshift({ type: current.name || "Error", value: clip(current.message, 1000), ...(frames.length ? { stacktrace: { frames } } : {}) });
      current = (current as { cause?: unknown }).cause;
    } else {
      values.unshift({ type: "NonError", value: clip(typeof current === "string" ? current : String(small(current)), 1000) });
      break;
    }
  }
  return values;
}

const disabled: ErrorReporter = {
  enabled: false,
  captureException() {},
  captureMessage() {},
  async flush() {},
};

export function createErrorReporter(options: ReporterOptions): ErrorReporter {
  const target = parseDsn(options.dsn);
  if (!target) return disabled;

  const send = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const perMinute = options.perMinute ?? 30;
  const pending = new Set<Promise<void>>();
  const recent = new Map<string, number>();
  let window = { start: 0, count: 0 };
  let lastWarning = 0;

  function allowed(fingerprint: string): boolean {
    const t = now();
    if (t - window.start >= 60_000) window = { start: t, count: 0 };
    if (window.count >= perMinute) return false;
    // The same failure again within a minute adds nothing but noise.
    const seen = recent.get(fingerprint);
    if (seen !== undefined && t - seen < 60_000) return false;
    recent.set(fingerprint, t);
    if (recent.size > 500) recent.delete(recent.keys().next().value!);
    window.count += 1;
    return true;
  }

  function deliver(event: Record<string, unknown>) {
    const eventId = globalThis.crypto.randomUUID().replace(/-/g, "");
    const t = now();
    const body = [
      JSON.stringify({ event_id: eventId, sent_at: new Date(t).toISOString() }),
      JSON.stringify({ type: "event" }),
      JSON.stringify({
        event_id: eventId,
        timestamp: t / 1000,
        platform: "node",
        server_name: options.service,
        release: options.release,
        environment: options.environment ?? "production",
        sdk: { name: "cryptovich.error-reporting", version: "1" },
        ...event,
      }),
    ].join("\n");
    const request = send(target!.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=cryptovich/${options.release}, sentry_key=${target!.publicKey}`,
      },
      body,
      signal: AbortSignal.timeout(5000),
    })
      .then(() => {})
      .catch((err: unknown) => {
        // A report that cannot be sent must never become an error of its own.
        if (now() - lastWarning > 60_000) {
          lastWarning = now();
          console.warn(`[error-reporting] could not reach the error server: ${err instanceof Error ? err.message : err}`);
        }
      })
      .finally(() => pending.delete(request));
    pending.add(request);
  }

  function tagsOf(context?: ReportContext): Record<string, string> {
    const tags: Record<string, string> = { service: options.service };
    for (const [key, value] of Object.entries(context?.tags ?? {})) {
      if (value !== undefined) tags[key] = clip(String(value), 200);
    }
    return tags;
  }

  return {
    enabled: true,
    captureException(error, context) {
      const values = exceptionValues(error);
      const top = values[values.length - 1];
      const frame = top?.stacktrace?.frames.filter((f) => f.in_app).pop();
      if (!allowed(`${top?.type}:${top?.value}:${frame?.filename}:${frame?.lineno}`)) return;
      deliver({
        level: "error",
        exception: { values },
        tags: tagsOf(context),
        ...(context?.extra ? { extra: small(context.extra) } : {}),
      });
    },
    captureMessage(message, level, context) {
      if (!allowed(`message:${message}`)) return;
      deliver({
        level,
        message: { formatted: clip(message, 1000) },
        tags: tagsOf(context),
        ...(context?.extra ? { extra: small(context.extra) } : {}),
      });
    },
    async flush(timeoutMs = 2000) {
      await Promise.race([Promise.allSettled([...pending]), new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
    },
  };
}
