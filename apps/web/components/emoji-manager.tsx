"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { safeHttpUrl } from "@platform/shared";
import { useLocale } from "./locale-provider";
import { Loading } from "@/components/loading";

interface CustomEmoji {
  id: string;
  shortcode: string;
  url: string;
  sourceInstance: string | null;
}

export function EmojiManager() {
  const { t } = useLocale();
  const [emoji, setEmoji] = useState<CustomEmoji[] | null>(null);
  const [shortcode, setShortcode] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setEmoji((await apiFetch<{ emoji: CustomEmoji[] }>("/emoji/mine")).emoji);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("emoji.loadError"));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/emoji", {
        method: "POST",
        body: JSON.stringify({ shortcode: shortcode.trim().toLowerCase(), url: url.trim() }),
      });
      setShortcode("");
      setUrl("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("emoji.saveError"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await apiFetch(`/emoji/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("emoji.saveError"));
    }
  }

  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>{t("emoji.title")}</h2>
      <p className="lede" style={{ margin: 0 }}>{t("emoji.lede")}</p>
      {error && <div className="error-banner">{error}</div>}

      <form className="row" style={{ gap: 8, alignItems: "flex-end" }} onSubmit={add}>
        <div className="form-field" style={{ minWidth: 140 }}>
          <label htmlFor="shortcode">{t("emoji.shortcode")}</label>
          <input
            id="shortcode"
            required
            maxLength={40}
            pattern="[a-zA-Z0-9_+-]+"
            value={shortcode}
            onChange={(e) => setShortcode(e.target.value)}
          />
        </div>
        <div className="form-field" style={{ flex: 1, minWidth: 220 }}>
          <label htmlFor="emojiUrl">{t("emoji.imageUrl")}</label>
          <input id="emojiUrl" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? t("common.saving") : t("emoji.add")}
        </button>
      </form>

      {emoji === null && <Loading />}
      {emoji?.length === 0 && <div className="empty-state">{t("emoji.empty")}</div>}
      {emoji && emoji.length > 0 && (
        <div className="row" style={{ gap: 10 }}>
          {emoji.map((e) => (
            <span key={e.id} className="chip" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={safeHttpUrl(e.url) ?? undefined} alt={`:${e.shortcode}:`} style={{ height: "1.3em" }} />
              :{e.shortcode}:
              <button className="link-button" aria-label={`${t("common.delete")} :${e.shortcode}:`} onClick={() => remove(e.id)}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
