"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { useLocale } from "@/components/locale-provider";
import { Loading } from "@/components/loading";
import { formatDate } from "@/lib/dates";
import { SendIcon } from "@/components/icons";

interface TelegramStatus {
  bridge: boolean;
  botUsername: string | null;
  link: {
    telegramUsername: string | null;
    receivePosts: boolean;
    publishEnabled: boolean;
    publishVisibility: "PUBLIC" | "SUBSCRIBERS";
    publishAsDraft: boolean;
    linkedAt: string;
  } | null;
}

/**
 * Кабинет → Telegram: linking this account to the server's bot, and what
 * the bot does — send new posts of the authors one follows or subscribes
 * to (whole when one may read them), and take posts written to it.
 */
export default function TelegramPage() {
  const { t, locale } = useLocale();
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [pending, setPending] = useState<{ url: string; code: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await apiFetch<TelegramStatus>("/telegram/me"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.genericError"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Waiting for /start in Telegram: look every few seconds until it is linked.
  useEffect(() => {
    if (!pending || status?.link) return;
    const timer = window.setInterval(load, 3000);
    return () => window.clearInterval(timer);
  }, [pending, status?.link, load]);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ url: string; code: string }>("/telegram/link", { method: "POST" });
      setPending(res);
      window.open(res.url, "_blank", "noopener");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.genericError"));
    } finally {
      setBusy(false);
    }
  }

  async function save(patch: Partial<NonNullable<TelegramStatus["link"]>>) {
    setError(null);
    try {
      setStatus(await apiFetch<TelegramStatus>("/telegram/me", { method: "PATCH", body: JSON.stringify(patch) }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.genericError"));
    }
  }

  async function unlink() {
    if (!window.confirm(t("telegram.unlinkConfirm"))) return;
    await apiFetch("/telegram/me", { method: "DELETE" }).catch(() => undefined);
    setPending(null);
    await load();
  }

  if (!status) return error ? <div className="error-banner">{error}</div> : <Loading />;
  const link = status.link;

  return (
    <div className="stack">
      <div>
        <h1>{t("telegram.title")}</h1>
        <p className="lede">{t("telegram.lede")}</p>
      </div>
      {error && <div className="error-banner">{error}</div>}

      {!status.bridge ? (
        <div className="empty-state">{t("telegram.off")}</div>
      ) : !link ? (
        <section className="card stack">
          <p style={{ margin: 0 }}>{t("telegram.connectHint")}</p>
          <button type="button" className="primary" onClick={connect} disabled={busy} style={{ alignSelf: "flex-start" }}>
            <SendIcon size={16} /> {t("telegram.connect")}
          </button>
          {pending && (
            <div className="stack" style={{ gap: 6 }} role="status">
              <span>
                {t("telegram.waiting")}{" "}
                <a href={pending.url} target="_blank" rel="noreferrer noopener">
                  {t("telegram.openBot", { bot: status.botUsername ?? "" })}
                </a>
              </span>
              <span className="meta">{t("telegram.codeHint", { code: pending.code })}</span>
            </div>
          )}
        </section>
      ) : (
        <>
          <section className="card stack">
            <strong>
              {t("telegram.linked", { name: link.telegramUsername ? `@${link.telegramUsername}` : "Telegram" })}
            </strong>
            <span className="meta">{t("telegram.linkedSince", { date: formatDate(link.linkedAt, locale) })}</span>
            <label className="checkbox-row">
              <input type="checkbox" checked={link.receivePosts} onChange={(e) => save({ receivePosts: e.target.checked })} />
              {t("telegram.receivePosts")}
            </label>
            <p className="meta" style={{ margin: 0 }}>
              {t("telegram.receiveHint")}
            </p>
          </section>
          <section className="card stack">
            <label className="checkbox-row">
              <input type="checkbox" checked={link.publishEnabled} onChange={(e) => save({ publishEnabled: e.target.checked })} />
              {t("telegram.publish")}
            </label>
            <p className="meta" style={{ margin: 0 }}>
              {t("telegram.publishHint")}
            </p>
            {link.publishEnabled && (
              <>
                <div className="form-field">
                  <label htmlFor="tg-visibility">{t("common.access")}</label>
                  <select id="tg-visibility" value={link.publishVisibility} onChange={(e) => save({ publishVisibility: e.target.value as "PUBLIC" | "SUBSCRIBERS" })}>
                    <option value="PUBLIC">{t("newPost.accessPublic")}</option>
                    <option value="SUBSCRIBERS">{t("newPost.accessSubscribers")}</option>
                  </select>
                </div>
                <label className="checkbox-row">
                  <input type="checkbox" checked={link.publishAsDraft} onChange={(e) => save({ publishAsDraft: e.target.checked })} />
                  {t("telegram.asDraft")}
                </label>
              </>
            )}
          </section>
          <section className="card stack">
            <strong>{t("telegram.commands")}</strong>
            <pre className="telegram-commands">{t("telegram.commandList")}</pre>
            <button type="button" className="danger" onClick={unlink} style={{ alignSelf: "flex-start" }}>
              {t("telegram.unlink")}
            </button>
          </section>
        </>
      )}
    </div>
  );
}
