"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Money, type Currency } from "@platform/shared";
import { apiFetch, apiUpload, API_URL, localizedErrorMessage } from "@/lib/api";
import { groupByCategory, type ServerEmoji } from "@/lib/server-emoji";
import { useLocale } from "@/components/locale-provider";
import { AwardIcon, ChevronDownIcon, PencilIcon, ScrollIcon, SearchIcon, TrashIcon } from "@/components/icons";
import { LogDialog } from "@/components/log-dialog";
import { RewardImage } from "@/components/rewards";
import { StatusPill } from "@/components/status-pill";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

interface AdminReward {
  id: string;
  emojiId: string;
  shortcode: string;
  imageUrl: string;
  priceMinor: string;
  currency: string;
  free: boolean;
  active: boolean;
  /** How many times it has been given. */
  given: number;
}

const REWARD_CURRENCIES = ["USD", "EUR"] as const;

/** One reward's price and whether it is on sale, saved together. */
function RewardRow({ reward, onSaved, onError }: { reward: AdminReward; onSaved: () => void; onError: (message: string) => void }) {
  const { t } = useLocale();
  const [price, setPrice] = useState(() => Money.fromMinor(BigInt(reward.priceMinor), reward.currency as Currency).toDecimalString());
  const [currency, setCurrency] = useState(reward.currency);
  const [active, setActive] = useState(reward.active);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch(`/admin/rewards/${reward.emojiId}`, {
        method: "PUT",
        body: JSON.stringify({ priceDecimal: price.trim(), currency, active }),
      });
      onSaved();
    } catch (err) {
      onError(localizedErrorMessage(err, t, "stickers.error"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    // One that has been given stays a reward, off sale; the API decides.
    if (!window.confirm(t(reward.given > 0 ? "stickers.rewardRemoveGiven" : "stickers.rewardRemove", { alias: reward.shortcode }))) return;
    try {
      await apiFetch(`/admin/rewards/${reward.emojiId}`, { method: "DELETE" });
      onSaved();
    } catch (err) {
      onError(localizedErrorMessage(err, t, "stickers.error"));
    }
  }

  return (
    <li>
      <form className="reward-admin-row" onSubmit={save}>
        <RewardImage reward={reward} size={40} />
        <span className="reward-admin-alias">
          :{reward.shortcode}:
          <span className="meta">{t("stickers.rewardGiven", { count: reward.given })}</span>
        </span>
        <label className="visually-hidden" htmlFor={`reward-price-${reward.id}`}>
          {t("stickers.rewardPrice")}
        </label>
        <input
          id={`reward-price-${reward.id}`}
          className="reward-admin-price"
          inputMode="decimal"
          pattern="\d+(\.\d{1,2})?"
          required
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <label className="visually-hidden" htmlFor={`reward-currency-${reward.id}`}>
          {t("goals.currency")}
        </label>
        <select id={`reward-currency-${reward.id}`} value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {REWARD_CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label className="checkbox-row">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t("stickers.rewardOnSale")}
        </label>
        <button className="secondary" type="submit" disabled={busy}>
          {t("common.save")}
        </button>
        <button
          type="button"
          className="action-item is-icon is-danger"
          aria-label={`${t("stickers.rewardRemoveLabel")}: ${reward.shortcode}`}
          title={t("stickers.rewardRemoveLabel")}
          onClick={remove}
        >
          <TrashIcon size={15} />
        </button>
      </form>
    </li>
  );
}

interface ImportLogEntry {
  id: string;
  name: string;
  shortcode: string | null;
  set: string | null;
  outcome: "ADDED" | "SKIPPED";
  reason: string | null;
}

interface ImportJob {
  id: string;
  source: "SHARKEY" | "TELEGRAM";
  sourceRef: string;
  category: string | null;
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED";
  importedCount: number;
  skippedCount: number;
  error: string | null;
  createdAt: string;
}

/**
 * The server's sticker library, as the administrator keeps it: add files,
 * import a whole set from a Sharkey/Misskey instance or Telegram, rename
 * or delete what is there. Everyone on the server uses what is here.
 */
export function StickersTab() {
  const { t } = useLocale();
  const [emoji, setEmoji] = useState<ServerEmoji[] | null>(null);
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [query, setQuery] = useState("");
  const [alias, setAlias] = useState("");
  const [set, setSet] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"SHARKEY" | "TELEGRAM">("SHARKEY");
  const [sourceRef, setSourceRef] = useState("");
  const [importSet, setImportSet] = useState("");
  const [busy, setBusy] = useState(false);
  // A fediverse instance's sets, read before importing, and the ones chosen.
  const [preview, setPreview] = useState<{ instance: string; software: string; total: number; categories: { name: string; count: number }[] } | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [allJobs, setAllJobs] = useState(false);
  // The import whose log is open, and the sets opened by hand: a set is
  // closed until asked for, so a library of thousands draws nothing it was
  // not asked to (each picture is a request).
  const [logJob, setLogJob] = useState<ImportJob | null>(null);
  const [openSets, setOpenSets] = useState<Set<string>>(new Set());
  const [rewards, setRewards] = useState<AdminReward[]>([]);

  const load = useCallback(async () => {
    try {
      const [list, imports, offered] = await Promise.all([
        apiFetch<{ emoji: ServerEmoji[] }>("/emoji/server"),
        apiFetch<{ jobs: ImportJob[] }>("/admin/emoji/imports"),
        apiFetch<{ rewards: AdminReward[] }>("/admin/rewards"),
      ]);
      setEmoji(list.emoji);
      setJobs(imports.jobs);
      setRewards(offered.rewards);
    } catch (err) {
      setError(localizedErrorMessage(err, t, "stickers.error"));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  // While an import is under way the worker is still adding rows; look again.
  useEffect(() => {
    if (!jobs.some((j) => j.status === "PENDING" || j.status === "RUNNING")) return;
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [jobs, load]);

  const sets = useMemo(() => groupByCategory(emoji ?? []), [emoji]);
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      sets
        .map((group) => ({
          ...group,
          emoji: q ? group.emoji.filter((e) => e.shortcode.includes(q) || e.category.toLowerCase().includes(q)) : group.emoji,
        }))
        .filter((group) => group.emoji.length > 0),
    [sets, q],
  );

  async function addFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setError(null);
    setNote(null);
    let done = 0;
    for (const file of files) {
      setProgress({ done, total: files.length });
      const params = new URLSearchParams();
      // An alias belongs to one sticker: with several files, each is named
      // after its own file instead.
      if (alias.trim() && files.length === 1) params.set("shortcode", alias.trim());
      if (set.trim()) params.set("category", set.trim());
      try {
        await apiUpload(`/admin/emoji?${params.toString()}`, file);
        done += 1;
      } catch (err) {
        setError(localizedErrorMessage(err, t, "stickers.error"));
        break;
      }
    }
    setProgress(null);
    setAlias("");
    if (done > 0) setNote(t("stickers.added", { count: done }));
    await load();
  }

  async function showSets() {
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const found = await apiFetch<NonNullable<typeof preview>>("/admin/emoji/imports/preview", {
        method: "POST",
        body: JSON.stringify({ sourceRef: sourceRef.trim() }),
      });
      setPreview(found);
      setChosen(new Set());
    } catch (err) {
      setError(localizedErrorMessage(err, t, "stickers.error"));
    } finally {
      setBusy(false);
    }
  }

  async function startImport(e: React.FormEvent) {
    e.preventDefault();
    // An instance is many sets: they are looked at and chosen first.
    if (source === "SHARKEY" && !preview) {
      await showSets();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/admin/emoji/imports", {
        method: "POST",
        body: JSON.stringify({
          source,
          sourceRef: source === "SHARKEY" && preview ? preview.instance : sourceRef.trim(),
          category: importSet.trim() || undefined,
          ...(source === "SHARKEY" ? { remoteCategories: [...chosen] } : {}),
        }),
      });
      setSourceRef("");
      setPreview(null);
      setChosen(new Set());
      await load();
    } catch (err) {
      setError(localizedErrorMessage(err, t, "stickers.error"));
    } finally {
      setBusy(false);
    }
  }

  async function rename(item: ServerEmoji) {
    const next = window.prompt(t("stickers.rename"), item.shortcode);
    if (!next || next === item.shortcode) return;
    try {
      await apiFetch(`/admin/emoji/${item.id}`, { method: "PATCH", body: JSON.stringify({ shortcode: next }) });
      await load();
    } catch (err) {
      setError(localizedErrorMessage(err, t, "stickers.error"));
    }
  }

  /** A sticker becomes a reward at a price the administrator names; edited below after that. */
  async function offerAsReward(item: ServerEmoji) {
    const price = window.prompt(t("stickers.rewardPricePrompt", { alias: item.shortcode }), "1.00");
    if (price === null) return;
    setError(null);
    try {
      await apiFetch(`/admin/rewards/${item.id}`, {
        method: "PUT",
        body: JSON.stringify({ priceDecimal: price.trim(), currency: "USD", active: true }),
      });
      await load();
    } catch (err) {
      setError(localizedErrorMessage(err, t, "stickers.error"));
    }
  }

  async function removeOne(item: ServerEmoji) {
    try {
      await apiFetch(`/admin/emoji/${item.id}`, { method: "DELETE" });
      setEmoji((prev) => prev?.filter((e) => e.id !== item.id) ?? prev);
    } catch (err) {
      setError(localizedErrorMessage(err, t, "stickers.error"));
    }
  }

  async function renameSet(category: string) {
    const name = window.prompt(t("stickers.renameSetPrompt", { set: category || t("picker.ungrouped") }), category)?.trim();
    if (!name || name === category) return;
    setError(null);
    try {
      await apiFetch(`/admin/emoji-sets/${encodeURIComponent(category)}`, { method: "PATCH", body: JSON.stringify({ name }) });
      setOpenSets((prev) => (prev.has(category) ? new Set([...prev, name]) : prev));
      await load();
    } catch (err) {
      setError(localizedErrorMessage(err, t, "stickers.error"));
    }
  }

  async function clearImports() {
    if (!window.confirm(t("stickers.clearImportsConfirm"))) return;
    setError(null);
    try {
      await apiFetch("/admin/emoji/imports", { method: "DELETE" });
      await load();
    } catch (err) {
      setError(localizedErrorMessage(err, t, "stickers.error"));
    }
  }

  const loadLog = useCallback(
    async ({ q, filter, cursor }: { q: string; filter: string; cursor: string | null }) => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (filter) params.set("outcome", filter);
      if (cursor) params.set("cursor", cursor);
      const res = await apiFetch<{ entries: ImportLogEntry[]; nextCursor: string | null }>(`/admin/emoji/imports/${logJob!.id}/log?${params}`);
      return { items: res.entries, nextCursor: res.nextCursor };
    },
    [logJob],
  );

  function toggleSet(category: string) {
    setOpenSets((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  async function removeSet(category: string) {
    if (!window.confirm(t("stickers.deleteSetConfirm", { set: category || t("picker.ungrouped") }))) return;
    try {
      await apiFetch(`/admin/emoji-sets/${encodeURIComponent(category)}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(localizedErrorMessage(err, t, "stickers.error"));
    }
  }

  return (
    <div className="stack">
      <div>
        <h1 style={{ marginBottom: 4 }}>{t("stickers.title")}</h1>
        <p className="lede" style={{ margin: 0 }}>{t("stickers.lede")}</p>
      </div>
      {error && <div className="error-banner">{error}</div>}

      <section className="card stack">
        <h2 style={{ margin: 0 }}>{t("stickers.addTitle")}</h2>
        <p className="meta" style={{ margin: 0 }}>{t("stickers.addHint")}</p>
        <div className="row" style={{ gap: 12 }}>
          <div className="form-field">
            <label htmlFor="sticker-alias">{t("stickers.alias")}</label>
            <input id="sticker-alias" value={alias} maxLength={40} onChange={(e) => setAlias(e.target.value)} placeholder="acat_confused" />
            <span className="meta">{t("stickers.aliasHint")}</span>
          </div>
          <div className="form-field">
            <label htmlFor="sticker-set">{t("stickers.set")}</label>
            <input id="sticker-set" value={set} maxLength={40} onChange={(e) => setSet(e.target.value)} placeholder="acat" />
            <span className="meta">{t("stickers.setHint")}</span>
          </div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <label className="btn-secondary file-pick">
            {t("stickers.choose")}
            <input type="file" accept="image/gif,image/png,image/webp,image/jpeg" multiple hidden onChange={addFiles} disabled={progress !== null} />
          </label>
          {progress && <span className="meta">{t("stickers.uploading", { done: progress.done + 1, total: progress.total })}</span>}
          {note && !progress && <span className="meta">{note}</span>}
        </div>
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0 }}>{t("stickers.importTitle")}</h2>
        <p className="meta" style={{ margin: 0 }}>{t("stickers.importHint")}</p>
        <form className="row" style={{ gap: 12, alignItems: "flex-end" }} onSubmit={startImport}>
          <div className="form-field">
            <label htmlFor="sticker-source">{t("stickers.source")}</label>
            <select
              id="sticker-source"
              value={source}
              onChange={(e) => {
                setSource(e.target.value as "SHARKEY" | "TELEGRAM");
                setPreview(null);
              }}
            >
              <option value="SHARKEY">Sharkey / Misskey / Mastodon</option>
              <option value="TELEGRAM">Telegram</option>
            </select>
          </div>
          <div className="form-field" style={{ flex: 1, minWidth: 220 }}>
            <label htmlFor="sticker-ref">{source === "SHARKEY" ? t("stickers.sourceRefSharkey") : t("stickers.sourceRefTelegram")}</label>
            <input
              id="sticker-ref"
              required
              value={sourceRef}
              onChange={(e) => {
                setSourceRef(e.target.value);
                setPreview(null);
              }}
            />
          </div>
          <div className="form-field">
            <label htmlFor="import-set">{t("stickers.targetSet")}</label>
            <input id="import-set" value={importSet} maxLength={40} onChange={(e) => setImportSet(e.target.value)} placeholder={t("stickers.targetSetPlaceholder")} />
          </div>
          {source === "SHARKEY" && !preview ? (
            <button className="primary" type="submit" disabled={busy || !sourceRef.trim()}>
              {t("stickers.showSets")}
            </button>
          ) : (
            <button className="primary" type="submit" disabled={busy || !sourceRef.trim() || (source === "SHARKEY" && chosen.size === 0)}>
              {source === "SHARKEY"
                ? t("stickers.importChosen", { count: [...chosen].reduce((n, name) => n + (preview?.categories.find((c) => c.name === name)?.count ?? 0), 0) })
                : t("stickers.startImport")}
            </button>
          )}
        </form>
        <p className="meta" style={{ margin: 0 }}>{t("stickers.targetSetHint")}</p>

        {source === "SHARKEY" && preview && (
          <fieldset className="sticker-sets">
            <legend>
              {t("stickers.setsOf", { instance: preview.instance.replace(/^https?:\/\//, ""), software: preview.software === "mastodon" ? "Mastodon" : "Misskey / Sharkey", total: preview.total })}
            </legend>
            {preview.categories.length === 0 && <p className="meta">{t("stickers.noSets")}</p>}
            {preview.categories.length > 1 && (
              <div className="row" style={{ gap: 6 }}>
                <button type="button" className="secondary" onClick={() => setChosen(new Set(preview.categories.map((c) => c.name)))}>
                  {t("stickers.selectAll")}
                </button>
                <button type="button" className="secondary" onClick={() => setChosen(new Set())}>
                  {t("stickers.selectNone")}
                </button>
              </div>
            )}
            <div className="sticker-sets-list">
              {preview.categories.map((c) => (
                <label key={c.name || "_"} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={chosen.has(c.name)}
                    onChange={(e) =>
                      setChosen((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(c.name);
                        else next.delete(c.name);
                        return next;
                      })
                    }
                  />
                  <span>
                    {c.name || t("stickers.ungroupedSet")} <span className="meta">({c.count})</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {jobs.length > 0 && (
          <>
            <div className="row sticker-jobs-head">
              <div className="picker-heading">{t("stickers.imports")}</div>
              {jobs.some((j) => j.status === "DONE" || j.status === "FAILED") && (
                <button type="button" className="action-item is-icon is-danger" onClick={clearImports} aria-label={t("stickers.clearImports")} title={t("stickers.clearImports")}>
                  <TrashIcon size={16} />
                </button>
              )}
            </div>
            <ul className="sticker-jobs">
              {(allJobs ? jobs : jobs.slice(0, 10)).map((job) => (
                <li key={job.id}>
                  <StatusPill prefix="stickers.jobStatus" status={job.status} />
                  <span className="sticker-job-ref">{job.sourceRef}</span>
                  <span className="meta">
                    {job.status === "FAILED"
                      ? job.error
                      : t("stickers.importDone", { imported: job.importedCount, skipped: job.skippedCount })}
                  </span>
                  {job.importedCount + job.skippedCount > 0 && (
                    <button type="button" className="link-button sticker-job-log" onClick={() => setLogJob(job)}>
                      <ScrollIcon size={15} />
                      {t("stickers.log")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {jobs.length > 10 && (
              <button type="button" className="link-button" onClick={() => setAllJobs((v) => !v)}>
                {allJobs ? t("stickers.fewerImports") : t("stickers.allImports", { count: jobs.length })}
              </button>
            )}
          </>
        )}
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0 }}>{t("stickers.rewardsTitle")}</h2>
        <p className="meta" style={{ margin: 0 }}>
          {t("stickers.rewardsHint")}
        </p>
        {rewards.length === 0 ? (
          <div className="empty-state">{t("stickers.rewardsEmpty")}</div>
        ) : (
          <ul className="reward-admin-list">
            {rewards.map((reward) => (
              <RewardRow
                // Re-mounted when the server's copy changes, so the fields show what was saved.
                key={`${reward.id}:${reward.priceMinor}:${reward.currency}:${reward.active}`}
                reward={reward}
                onSaved={load}
                onError={setError}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0 }}>
          {t("stickers.library")} {emoji ? `(${emoji.length})` : ""}
        </h2>
        <label className="search-form">
          <SearchIcon size={18} />
          <span className="visually-hidden">{t("stickers.searchPlaceholder")}</span>
          <input type="search" value={query} placeholder={t("stickers.searchPlaceholder")} onChange={(e) => setQuery(e.target.value)} />
        </label>

        {emoji !== null && filtered.length === 0 && <div className="empty-state">{t("stickers.empty")}</div>}
        {filtered.map((group) => {
          // Searching opens every set that has a match.
          const open = Boolean(q) || openSets.has(group.category);
          return (
          <div key={group.category || "_"} className={`sticker-set${open ? " is-open" : ""}`}>
            <div className="sticker-set-head">
              <button type="button" className="sticker-set-toggle" aria-expanded={open} onClick={() => toggleSet(group.category)}>
                <ChevronDownIcon size={16} />
                <strong>{group.category || t("picker.ungrouped")}</strong> <span className="meta">({group.emoji.length})</span>
              </button>
              <button type="button" className="action-item is-icon" onClick={() => renameSet(group.category)} aria-label={`${t("stickers.renameSet")}: ${group.category || t("picker.ungrouped")}`} title={t("stickers.renameSet")}>
                <PencilIcon size={15} />
              </button>
              <button type="button" className="action-item is-icon is-danger" onClick={() => removeSet(group.category)} aria-label={`${t("stickers.deleteSet")}: ${group.category || t("picker.ungrouped")}`} title={t("stickers.deleteSet")}>
                <TrashIcon size={15} />
              </button>
            </div>
            {open && (
            <ul className="sticker-grid">
              {group.emoji.map((item) => (
                <li key={item.id} className="sticker-tile">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`${API_URL}${item.url}`} alt={`:${item.shortcode}:`} loading="lazy" />
                  <button type="button" className="sticker-alias" title={t("stickers.rename")} onClick={() => rename(item)}>
                    :{item.shortcode}:
                  </button>
                  {item.reward ? (
                    <span className="sticker-reward-mark" title={t("stickers.isReward")} aria-label={t("stickers.isReward")}>
                      <AwardIcon size={15} />
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="action-item is-icon"
                      aria-label={`${t("stickers.makeReward")}: ${item.shortcode}`}
                      title={t("stickers.makeReward")}
                      onClick={() => offerAsReward(item)}
                    >
                      <AwardIcon size={15} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="action-item is-icon is-danger"
                    aria-label={`${t("stickers.deleteOne")}: ${item.shortcode}`}
                    title={t("stickers.deleteOne")}
                    onClick={() => removeOne(item)}
                  >
                    <TrashIcon size={15} />
                  </button>
                </li>
              ))}
            </ul>
            )}
          </div>
          );
        })}
      </section>

      {logJob && (
        <LogDialog<ImportLogEntry>
          title={t("stickers.logTitle", { source: logJob.sourceRef })}
          summary={t("stickers.logSummary", { added: logJob.importedCount, skipped: logJob.skippedCount })}
          filters={[
            { value: "", label: t("log.all") },
            { value: "SKIPPED", label: t("stickers.logSkipped") },
            { value: "ADDED", label: t("stickers.logAdded") },
          ]}
          load={loadLog}
          itemKey={(e) => e.id}
          onClose={() => setLogJob(null)}
          renderItem={(e) => (
            <div className="log-row">
              <StatusPill prefix="stickers.outcome" status={e.outcome} />
              <span className="log-row-main">
                <strong>{e.name}</strong>
                {e.shortcode && <span className="meta"> :{e.shortcode}:</span>}
                {e.set && <span className="meta"> · {e.set}</span>}
              </span>
              {e.reason && <span className="meta log-row-why">{t(`stickers.reason.${e.reason}` as TranslationKey)}</span>}
            </div>
          )}
        />
      )}
    </div>
  );
}
