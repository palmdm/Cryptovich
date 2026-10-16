import type { ComponentId, State } from "./checks.js";

/** Half hours for the last week, days for the last 90 — UptimeRobot's two views. */
export const BUCKET_MS = 30 * 60_000;
export const DAY_MS = 24 * 60 * 60_000;
const KEEP_HALF_HOURS_MS = 7 * DAY_MS;
const KEEP_DAYS_MS = 90 * DAY_MS;
const EVENTS_KEPT = 50;

export type Range = "24h" | "90d";

interface Bucket {
  start: number;
  /** Checks that found it working (with or without trouble). */
  up: number;
  /** Checks that count: everything but those during maintenance. */
  total: number;
  /** Checks during a maintenance window that found it not working — left out of uptime. */
  maintenance: number;
  worst: State;
}

/** A part changing state, for the "recent events" list. */
export interface StateChange {
  at: number;
  id: ComponentId;
  state: State;
}

const RANK: Record<State, number> = { operational: 0, maintenance: 1, degraded: 2, down: 3 };

function add(list: Bucket[], size: number, keepMs: number, state: State, at: number): void {
  const start = Math.floor(at / size) * size;
  let bucket = list[list.length - 1];
  if (!bucket || bucket.start !== start) {
    bucket = { start, up: 0, total: 0, maintenance: 0, worst: "operational" };
    list.push(bucket);
  }
  if (state === "maintenance") {
    bucket.maintenance += 1;
  } else {
    bucket.total += 1;
    if (state !== "down") bucket.up += 1;
  }
  if (RANK[state] > RANK[bucket.worst]) bucket.worst = state;
  while (list.length && list[0]!.start < at - keepMs) list.shift();
}

/**
 * The colour of one bar. All checks up: the worst it was (trouble, or a
 * maintenance window it came through). Otherwise down only when it was
 * down for more than `outage` of the time — a blip in a half hour, or an
 * hour in a day, is trouble, not an outage.
 */
function barState(bucket: Bucket | undefined, outage: number): State | null {
  if (!bucket) return null;
  if (bucket.total === 0) return bucket.maintenance ? "maintenance" : null;
  if (bucket.up === bucket.total) return bucket.worst;
  return bucket.up / bucket.total >= 1 - outage ? "degraded" : "down";
}

const isBucket = (b: unknown): b is Bucket => {
  const x = b as Bucket | null;
  return !!x && typeof x.start === "number" && typeof x.up === "number" && typeof x.total === "number" && x.worst in RANK;
};
const bucketsFrom = (list: unknown): Bucket[] =>
  Array.isArray(list) ? list.filter(isBucket).map((b) => ({ ...b, maintenance: typeof b.maintenance === "number" ? b.maintenance : 0 })) : [];

/**
 * What each part looked like: every check counted into its half hour (kept
 * a week) and its day (kept 90 days), plus the last state changes. Small
 * enough to keep in memory and write to a file whole.
 */
export class History {
  private readonly halfHours = new Map<string, Bucket[]>();
  private readonly days = new Map<string, Bucket[]>();
  private events: StateChange[] = [];
  private readonly last = new Map<string, State>();

  record(id: ComponentId, state: State, at: number): void {
    const halfHours = this.halfHours.get(id) ?? [];
    add(halfHours, BUCKET_MS, KEEP_HALF_HOURS_MS, state, at);
    this.halfHours.set(id, halfHours);
    const days = this.days.get(id) ?? [];
    add(days, DAY_MS, KEEP_DAYS_MS, state, at);
    this.days.set(id, days);

    const before = this.last.get(id);
    if (before !== undefined && before !== state) {
      this.events.push({ at, id, state });
      if (this.events.length > EVENTS_KEPT) this.events.splice(0, this.events.length - EVENTS_KEPT);
    }
    this.last.set(id, state);
  }

  /** The bars for a range, oldest first; null where nothing was checked. */
  series(id: ComponentId, now: number, range: Range): { start: number; size: number; state: State | null; uptime: number | null }[] {
    const [list, size, count, outage] =
      range === "24h" ? [this.halfHours.get(id) ?? [], BUCKET_MS, 48, 0.5] : [this.days.get(id) ?? [], DAY_MS, 90, 0.05];
    const byStart = new Map(list.map((b) => [b.start, b]));
    const last = Math.floor(now / size) * size;
    return Array.from({ length: count }, (_, i) => {
      const start = last - (count - 1 - i) * size;
      const bucket = byStart.get(start);
      return { start, size, state: barState(bucket, outage), uptime: bucket && bucket.total ? bucket.up / bucket.total : null };
    });
  }

  /**
   * Share of checks that found it up over the last `hours`, or null with
   * none. A maintenance window is left out, the way UptimeRobot does.
   * Half hours answer up to a week, days beyond it.
   */
  uptime(id: ComponentId, now: number, hours: number): number | null {
    const [list, size] = hours <= 24 * 7 ? [this.halfHours.get(id) ?? [], BUCKET_MS] : [this.days.get(id) ?? [], DAY_MS];
    let up = 0;
    let total = 0;
    for (const bucket of list) {
      if (bucket.start + size <= now - hours * 60 * 60_000) continue;
      up += bucket.up;
      total += bucket.total;
    }
    return total ? up / total : null;
  }

  /** The latest state changes, newest first. */
  recent(limit: number): StateChange[] {
    return this.events.slice(-limit).reverse();
  }

  toJSON() {
    return {
      version: 2,
      halfHours: Object.fromEntries(this.halfHours),
      days: Object.fromEntries(this.days),
      events: this.events,
      last: Object.fromEntries(this.last),
    };
  }

  /** Reads its own file — or the first version's, a week of half hours, which it also counts into days. */
  static fromJSON(data: unknown): History {
    const history = new History();
    if (!data || typeof data !== "object") return history;
    const file = data as Record<string, unknown>;
    if (file.version === 2) {
      for (const [key, target] of [["halfHours", history.halfHours], ["days", history.days]] as const) {
        const lists = file[key];
        if (lists && typeof lists === "object") {
          for (const [id, list] of Object.entries(lists as Record<string, unknown>)) target.set(id, bucketsFrom(list));
        }
      }
      if (Array.isArray(file.events)) {
        history.events = file.events
          .filter((e): e is StateChange => !!e && typeof e.at === "number" && typeof e.id === "string" && e.state in RANK)
          .slice(-EVENTS_KEPT);
      }
      if (file.last && typeof file.last === "object") {
        for (const [id, state] of Object.entries(file.last as Record<string, unknown>)) {
          if (typeof state === "string" && state in RANK) history.last.set(id, state as State);
        }
      }
      return history;
    }
    for (const [id, list] of Object.entries(file)) {
      const halfHours = bucketsFrom(list);
      history.halfHours.set(id, halfHours);
      const days: Bucket[] = [];
      for (const b of halfHours) {
        const start = Math.floor(b.start / DAY_MS) * DAY_MS;
        let day = days[days.length - 1];
        if (!day || day.start !== start) {
          day = { start, up: 0, total: 0, maintenance: 0, worst: "operational" };
          days.push(day);
        }
        day.up += b.up;
        day.total += b.total;
        day.maintenance += b.maintenance;
        if (RANK[b.worst] > RANK[day.worst]) day.worst = b.worst;
      }
      history.days.set(id, days);
    }
    return history;
  }
}
