"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { useLocale } from "./locale-provider";

/**
 * The optional "talk to me" link shown on the author's public profile.
 * The platform hosts no messaging of its own — this points at wherever
 * the author already is (a Delta Chat invite, a Matrix room, an inbox).
 */
export function ChatLinkSetting() {
  const { t } = useLocale();
  const [chatUrl, setChatUrl] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<{ creatorProfile: { chatUrl: string | null } }>("/creators/me")
      .then((res) => setChatUrl(res.creatorProfile.chatUrl ?? ""))
      .catch(() => {});
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      // Empty string clears the link, matching how the other optional
      // profile fields behave.
      await apiFetch("/creators/me", { method: "PATCH", body: JSON.stringify({ chatUrl: chatUrl.trim() }) });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.genericError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={save}>
      <h2 style={{ margin: 0 }}>{t("profile.chat")}</h2>
      <p className="lede" style={{ margin: 0 }}>{t("profile.chatHint")}</p>
      {error && <div className="error-banner">{error}</div>}
      <div className="form-field">
        <label htmlFor="chatUrl">{t("form.url")}</label>
        <input
          id="chatUrl"
          type="url"
          placeholder="https://i.delta.chat/#..."
          value={chatUrl}
          onChange={(e) => setChatUrl(e.target.value)}
        />
      </div>
      <div className="row" style={{ gap: 10 }}>
        <button className="primary" type="submit" disabled={busy} style={{ width: "fit-content" }}>
          {busy ? t("common.saving") : t("common.save")}
        </button>
        {saved && <span className="meta">{t("common.save")} ✓</span>}
      </div>
    </form>
  );
}
