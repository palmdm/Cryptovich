import type { ComponentId, State } from "./checks.js";
import { COMPONENTS } from "./checks.js";
import type { History, Range, StateChange } from "./history.js";

export type Lang = "ru" | "en" | "ja";

export interface Snapshot {
  /** When the last round finished; null before the first. */
  updatedAt: number | null;
  components: { id: ComponentId; state: State; since: number; latencyMs?: number }[];
  /** `maintenance` while an update is announced (see index.ts). */
  overall: State | null;
}

const TEXT = {
  ru: {
    title: "Состояние Cryptovich",
    overall: {
      operational: "Все системы работают",
      degraded: "Есть неполадки",
      down: "Часть сервиса не работает",
      maintenance: "Идёт плановое обновление — Cryptovich скоро вернётся",
      null: "Идёт первая проверка",
    },
    state: { operational: "Работает", degraded: "С перебоями", down: "Не работает", maintenance: "Обслуживание", none: "Нет данных" },
    names: { web: "Сайт", api: "API", database: "База данных", redis: "Кэш и очереди", worker: "Фоновые задачи" },
    since: "с",
    response: "отвечает за",
    ms: "мс",
    updated: "Обновлено",
    about: "Эта страница проверяет Cryptovich каждые {interval} секунд и работает отдельно от него — она откроется, даже если сайт не открывается. Время — UTC.",
    open: "Открыть Cryptovich",
    range: { "90d": "90 дней", "24h": "24 часа" },
    from: { "90d": "90 дней назад", "30d": "30 дней назад", "24h": "24 часа назад" },
    to: { "90d": "Сегодня", "24h": "Сейчас" },
    uptimeFor: { "90d": "за 90 дней", "24h": "за 24 часа" },
    overallUptime: "Аптайм Cryptovich",
    periods: ["24 часа", "7 дней", "30 дней", "90 дней"],
    events: "Последние события",
    noEvents: "Пока ничего не случалось — всё работало.",
    still: "до сих пор",
    minutes: (m: number) => (m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч${m % 60 ? ` ${m % 60} мин` : ""}`),
  },
  en: {
    title: "Cryptovich status",
    overall: {
      operational: "All systems operational",
      degraded: "Some systems are having trouble",
      down: "Part of the service is down",
      maintenance: "Scheduled maintenance — Cryptovich will be back shortly",
      null: "Running the first check",
    },
    state: { operational: "Operational", degraded: "Degraded", down: "Down", maintenance: "Maintenance", none: "No data" },
    names: { web: "Website", api: "API", database: "Database", redis: "Cache and queues", worker: "Background jobs" },
    since: "since",
    response: "responds in",
    ms: "ms",
    updated: "Updated",
    about: "This page checks Cryptovich every {interval} seconds and runs separately from it — it opens even when the site does not. Times are UTC.",
    open: "Open Cryptovich",
    range: { "90d": "90 days", "24h": "24 hours" },
    from: { "90d": "90 days ago", "30d": "30 days ago", "24h": "24 hours ago" },
    to: { "90d": "Today", "24h": "Now" },
    uptimeFor: { "90d": "over 90 days", "24h": "over 24 hours" },
    overallUptime: "Cryptovich uptime",
    periods: ["24 hours", "7 days", "30 days", "90 days"],
    events: "Recent events",
    noEvents: "Nothing has happened yet — everything has been working.",
    still: "ongoing",
    minutes: (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`),
  },
  ja: {
    title: "Cryptovich の稼働状況",
    overall: {
      operational: "すべて正常に稼働中",
      degraded: "一部で問題が発生しています",
      down: "サービスの一部が停止しています",
      maintenance: "メンテナンス中です — まもなく復旧します",
      null: "最初の確認を実行中",
    },
    state: { operational: "正常", degraded: "一部障害", down: "停止", maintenance: "メンテナンス", none: "データなし" },
    names: { web: "ウェブサイト", api: "API", database: "データベース", redis: "キャッシュとキュー", worker: "バックグラウンド処理" },
    since: "以降",
    response: "応答時間",
    ms: "ms",
    updated: "更新",
    about: "このページは {interval} 秒ごとに Cryptovich を確認しており、Cryptovich とは別に動いています。サイトが開けないときでも表示されます。時刻は UTC です。",
    open: "Cryptovich を開く",
    range: { "90d": "90日間", "24h": "24時間" },
    from: { "90d": "90日前", "30d": "30日前", "24h": "24時間前" },
    to: { "90d": "今日", "24h": "現在" },
    uptimeFor: { "90d": "（90日間）", "24h": "（24時間）" },
    overallUptime: "Cryptovich の稼働率",
    periods: ["24時間", "7日間", "30日間", "90日間"],
    events: "最近のイベント",
    noEvents: "まだ何も起きていません — すべて正常に稼働しています。",
    still: "継続中",
    minutes: (m: number) => (m < 60 ? `${m}分` : `${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ""}`),
  },
} as const;

/** The reader's language from `?lang=` or Accept-Language; English otherwise. */
export function pickLang(query: string | null, acceptLanguage: string | undefined): Lang {
  for (const candidate of [query ?? "", ...(acceptLanguage ?? "").split(",").map((part) => part.split(";")[0]!.trim())]) {
    const code = candidate.toLowerCase().slice(0, 2);
    if (code === "ru" || code === "en" || code === "ja") return code;
  }
  return "en";
}

/** `?range=24h` for the last day in half hours; 90 days otherwise. */
export function pickRange(query: string | null): Range {
  return query === "24h" ? "24h" : "90d";
}

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const clock = (at: number) => `${new Date(at).toISOString().slice(11, 16)}`;
const percent = (share: number | null) => (share === null ? "—" : `${(Math.floor(share * 10000) / 100).toFixed(2)}%`);
const dayLabel = (lang: Lang, at: number) => new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", timeZone: "UTC" }).format(at);

const COLOR: Record<State | "none", string> = {
  operational: "var(--ok)",
  degraded: "var(--warn)",
  down: "var(--bad)",
  maintenance: "var(--maint)",
  none: "var(--none)",
};

/** A dot the colour of the whole, for the tab: the state shows even in a background tab. */
function favicon(state: State | null): string {
  const fill = { operational: "#00ba7c", degraded: "#ffad1f", down: "#f4212e", maintenance: "#1d9bf0" }[state ?? "operational"];
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="${fill}"/></svg>`)}`;
}

/** The average of the parts that have data — UptimeRobot's "overall uptime". */
function overallUptime(history: History, now: number, hours: number): number | null {
  const shares = COMPONENTS.map((id) => history.uptime(id, now, hours)).filter((share): share is number => share !== null);
  return shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : null;
}

function eventList(events: StateChange[], lang: Lang, now: number): string {
  const t = TEXT[lang];
  if (events.length === 0) return `<p class="quiet">${escape(t.noEvents)}</p>`;
  // Parts that changed together in one round are one line: `docker
  // compose down` takes everything at once, and five identical lines say
  // less than one.
  const groups: { at: number; state: State; ids: ComponentId[] }[] = [];
  for (const event of events) {
    const group = groups[groups.length - 1];
    if (group && group.at === event.at && group.state === event.state) group.ids.push(event.id);
    else groups.push({ at: event.at, state: event.state, ids: [event.id] });
  }
  const items = groups.slice(0, 8).map((group) => {
    // How long it lasted: until the last of them changed again.
    const ends = group.ids.map((id) => events.filter((e) => e.id === id && e.at > group.at).at(-1)?.at ?? null);
    const ongoing = ends.some((end) => end === null);
    const end = ongoing ? now : Math.max(...(ends as number[]));
    const lasted = group.state === "operational" ? "" : ` · ${ongoing ? `${t.still} (${t.minutes(Math.max(1, Math.round((end - group.at) / 60_000)))})` : t.minutes(Math.max(1, Math.round((end - group.at) / 60_000)))}`;
    const names = [...group.ids].sort((a, b) => COMPONENTS.indexOf(a) - COMPONENTS.indexOf(b)).map((id) => escape(t.names[id]));
    return `<li><span class="dot" style="background:${COLOR[group.state]}"></span><span><b>${names.join(", ")}</b> — ${escape(t.state[group.state])}${escape(lasted)}</span><time>${escape(dayLabel(lang, group.at))}, ${clock(group.at)}</time></li>`;
  });
  return `<ol class="events">${items.join("")}</ol>`;
}

export function renderHtml(
  snapshot: Snapshot,
  history: History,
  options: { lang: Lang; now: number; intervalSeconds: number; siteUrl: string | null; range?: Range; langInQuery?: boolean },
): string {
  const t = TEXT[options.lang];
  const range = options.range ?? "90d";
  const link = (r: Range) => `?range=${r}${options.langInQuery ? `&amp;lang=${options.lang}` : ""}`;
  const rows = snapshot.components
    .map((component) => {
      const bars = history
        .series(component.id, options.now, range)
        .map(({ start, size, state, uptime }) => {
          const when = range === "24h" ? `${clock(start)}–${clock(start + size)}` : dayLabel(options.lang, start);
          const label = `${when}: ${state ? t.state[state] : t.state.none}${range === "90d" && uptime !== null ? ` · ${percent(uptime)}` : ""}`;
          return `<i style="background:${COLOR[state ?? "none"]}" title="${escape(label)}"></i>`;
        })
        .join("");
      const latency = component.latencyMs !== undefined && component.state !== "down" ? ` · ${t.response} ${component.latencyMs} ${t.ms}` : "";
      const since =
        component.state !== "operational" ? ` · ${t.since} ${range === "24h" ? "" : `${dayLabel(options.lang, component.since)}, `}${clock(component.since)}` : "";
      const share = history.uptime(component.id, options.now, range === "24h" ? 24 : 24 * 90);
      return `<li>
  <div class="row"><span class="name">${escape(t.names[component.id])}</span><span class="state" style="color:${COLOR[component.state]}">${escape(t.state[component.state])}</span></div>
  <div class="bars bars-${range}" aria-hidden="true">${bars}</div>
  <div class="meta"><b>${percent(share)}</b> ${escape(t.uptimeFor[range])}${escape(latency)}${escape(since)}</div>
</li>`;
    })
    .join("\n");
  const overallKey = snapshot.overall ?? "null";
  const periods = [24, 24 * 7, 24 * 30, 24 * 90]
    .map((hours, i) => `<div><b>${percent(overallUptime(history, options.now, hours))}</b><span>${escape(t.periods[i]!)}</span></div>`)
    .join("");
  return `<!doctype html>
<html lang="${options.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60">
<meta name="robots" content="noindex">
<title>${escape(t.title)}</title>
<link rel="icon" href="${favicon(snapshot.overall)}">
<style>
:root { --bg: #ffffff; --card: #ffffff; --text: #0f1419; --muted: #536471; --line: #eff3f4; --ok: #00ba7c; --warn: #e89a00; --bad: #f4212e; --maint: #1d9bf0; --none: #cfd9de; --accent: #1d9bf0; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --bg: #000000; --card: #16181c; --text: #e7e9ea; --muted: #71767b; --line: #2f3336; --none: #333639; --warn: #ffad1f; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 28px 16px 40px; }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
h1 { margin: 0; font-size: 1.35rem; }
h2 { margin: 26px 0 10px; font-size: 1rem; }
header a { color: var(--accent); text-decoration: none; font-weight: 600; }
.banner { margin: 18px 0 16px; padding: 16px 18px; border-radius: 16px; color: #ffffff; font-weight: 700; font-size: 1.05rem; background: ${snapshot.overall ? COLOR[snapshot.overall] : "var(--muted)"}; }
.ranges { display: flex; justify-content: flex-end; gap: 4px; margin: 0 0 10px; }
.ranges a { padding: 4px 12px; border-radius: 999px; color: var(--muted); text-decoration: none; font-size: 0.85rem; font-weight: 600; }
.ranges a[aria-current] { background: var(--line); color: var(--text); }
ul, ol { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: 16px; background: var(--card); }
ul > li, ol > li { padding: 14px 16px; border-bottom: 1px solid var(--line); }
ul > li:last-child, ol > li:last-child { border-bottom: none; }
.row { display: flex; justify-content: space-between; gap: 12px; font-weight: 600; }
.state { white-space: nowrap; }
.bars { display: grid; gap: 2px; height: 30px; margin: 10px 0 6px; }
.bars-24h { grid-template-columns: repeat(48, 1fr); }
.bars-90d { grid-template-columns: repeat(90, 1fr); }
.bars i { border-radius: 2px; }
.meta { color: var(--muted); font-size: 0.85rem; }
.meta b { color: var(--text); font-weight: 600; }
.axis { display: flex; justify-content: space-between; color: var(--muted); font-size: 0.75rem; margin: 6px 4px 0; }
.axis .short { display: none; }
.uptime { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid var(--line); border-radius: 16px; background: var(--card); }
.uptime div { display: grid; gap: 2px; padding: 14px 10px; text-align: center; border-left: 1px solid var(--line); }
.uptime div:first-child { border-left: none; }
.uptime b { font-size: 1.15rem; }
.uptime span { color: var(--muted); font-size: 0.8rem; }
.events li { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px; font-size: 0.9rem; }
.events .dot { width: 10px; height: 10px; border-radius: 50%; }
.events time { color: var(--muted); font-size: 0.8rem; white-space: nowrap; }
.quiet { color: var(--muted); margin: 0; }
footer { margin-top: 22px; color: var(--muted); font-size: 0.82rem; }
footer a { color: inherit; }
/* A phone shows the last 30 days: 90 bars would be hairlines. */
@media (max-width: 600px) {
  .bars-90d { grid-template-columns: repeat(30, 1fr); }
  .bars-90d i:nth-child(-n + 60) { display: none; }
  .axis-90d .long { display: none; }
  .axis-90d .short { display: inline; }
  .uptime { grid-template-columns: repeat(2, 1fr); }
  .uptime div:nth-child(3) { border-left: none; }
  .uptime div:nth-child(n + 3) { border-top: 1px solid var(--line); }
  .events li { grid-template-columns: auto 1fr; }
  .events time { grid-column: 2; }
}
</style>
</head>
<body>
<main>
<header><h1>${escape(t.title)}</h1>${options.siteUrl ? `<a href="${escape(options.siteUrl)}">${escape(t.open)} →</a>` : ""}</header>
<div class="banner" role="status">${escape(t.overall[overallKey])}</div>
<nav class="ranges">${(["90d", "24h"] as const)
    .map((r) => `<a href="${link(r)}"${r === range ? ' aria-current="page"' : ""}>${escape(t.range[r])}</a>`)
    .join("")}</nav>
<ul>
${rows}
</ul>
<div class="axis axis-${range}"><span><span class="long">${escape(t.from[range])}</span>${range === "90d" ? `<span class="short">${escape(t.from["30d"])}</span>` : ""}</span><span>${escape(t.to[range])}${snapshot.updatedAt ? ` · ${escape(t.updated)} ${clock(snapshot.updatedAt)} UTC` : ""}</span></div>
<h2>${escape(t.overallUptime)}</h2>
<div class="uptime">${periods}</div>
<h2>${escape(t.events)}</h2>
${eventList(history.recent(50), options.lang, options.now)}
<footer><p>${escape(t.about.replace("{interval}", String(options.intervalSeconds)))}</p><p><a href="/status.json">status.json</a></p></footer>
</main>
</body>
</html>`;
}

/** The same, for a monitor: states, uptime and recent changes — nothing about how Cryptovich is built. */
export function renderJson(snapshot: Snapshot, history: History, now: number) {
  return {
    status: snapshot.overall,
    updatedAt: snapshot.updatedAt ? new Date(snapshot.updatedAt).toISOString() : null,
    components: snapshot.components.map((component) => ({
      id: component.id,
      status: component.state,
      since: new Date(component.since).toISOString(),
      ...(component.latencyMs !== undefined ? { latencyMs: component.latencyMs } : {}),
      uptime24h: history.uptime(component.id, now, 24),
      uptime7d: history.uptime(component.id, now, 24 * 7),
      uptime30d: history.uptime(component.id, now, 24 * 30),
      uptime90d: history.uptime(component.id, now, 24 * 90),
    })),
    events: history.recent(10).map((event) => ({ at: new Date(event.at).toISOString(), component: event.id, status: event.state })),
  };
}
