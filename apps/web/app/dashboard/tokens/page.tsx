"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError, API_URL } from "@/lib/api";
import { useLocale } from "@/components/locale-provider";
import { formatDate, formatDateTime } from "@/lib/dates";
import { FileTextIcon } from "@/components/icons";
import { Loading } from "@/components/loading";

interface Token {
  id: string;
  name: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export default function TokensDashboardPage() {
  const { t, locale } = useLocale();
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [name, setName] = useState("");
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ tokens: Token[] }>("/tokens/mine");
      setTokens(res.tokens);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("tokens.loadError"));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch<{ token: string }>("/tokens", { method: "POST", body: JSON.stringify({ name }) });
      setJustCreated(res.token);
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("tokens.createError"));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setError(null);
    try {
      await apiFetch(`/tokens/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("tokens.revokeError"));
    }
  }

  return (
    <div className="stack">
      <h1>{t("tokens.title")}</h1>
      <p className="lede" style={{ margin: 0 }}>
        {t("tokens.lede")} {t("tokens.howTo")} <code>Authorization: Bearer &lt;token&gt;</code>
      </p>
      <div>
        <a className="btn-secondary" href={`${API_URL}/docs`} target="_blank" rel="noreferrer">
          <FileTextIcon size={16} />
          {t("tokens.docs")}
        </a>
      </div>
      {error && <div className="error-banner">{error}</div>}

      {justCreated && (
        <div className="card" style={{ borderColor: "var(--accent)" }}>
          <strong>{t("tokens.copyNow")}</strong>
          <code style={{ display: "block", marginTop: 8, wordBreak: "break-all", padding: 10, background: "var(--surface-2)", borderRadius: 8 }}>
            {justCreated}
          </code>
          <button className="secondary" style={{ marginTop: 8 }} onClick={() => setJustCreated(null)}>
            Dismiss
          </button>
        </div>
      )}

      <form className="stack card" onSubmit={create}>
        <div className="form-field">
          <label htmlFor="name">{t("tokens.nameLabel")}</label>
          <input id="name" required placeholder={t("tokens.namePlaceholder")} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <button className="primary" type="submit" disabled={busy} style={{ alignSelf: "flex-start" }}>
          {busy ? t("common.creating") : t("tokens.create")}
        </button>
      </form>

      {tokens === null && <Loading />}
      {tokens?.length === 0 && <div className="empty-state">{t("tokens.empty")}</div>}
      {tokens && tokens.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {tokens.map((token) => (
            <div key={token.id} className="card" style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div>
                <strong>{token.name}</strong>
                <div className="lede" style={{ margin: "4px 0 0", fontSize: "0.82rem" }}>
                  {t("tokens.created", { date: formatDate(token.createdAt, locale) })}
                  {" · "}
                  {token.lastUsedAt
                    ? t("tokens.lastUsed", { date: formatDateTime(token.lastUsedAt, locale) })
                    : t("tokens.neverUsed")}
                </div>
              </div>
              <button className="secondary" onClick={() => revoke(token.id)}>
                {t("tokens.revoke")}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
