"use client";

import { useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import { useLocale } from "@/components/locale-provider";

export default function ForgotPasswordPage() {
  const { t } = useLocale();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/auth/password-reset/request", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } catch (err) {
      // A server with no mailer refuses outright and says so — that is
      // worth showing, unlike anything address-specific.
      setError(err instanceof ApiError ? err.message : t("forgot.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-narrow">
      <h1>{t("forgot.title")}</h1>
      <p className="lede">{t("forgot.lede")}</p>

      {sent ? (
        <div className="stack">
          {/* Deliberately the same message whether or not that address
              has an account — the API answers identically too. */}
          <div className="card">{t("forgot.sent")}</div>
          <Link href="/login" className="btn-secondary" style={{ width: "fit-content" }}>
            {t("nav.signIn")}
          </Link>
        </div>
      ) : (
        <form className="stack auth-form" onSubmit={handleSubmit}>
          {error && <div className="error-banner">{error}</div>}
          <div className="form-field">
            <label htmlFor="email">{t("forgot.email")}</label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? t("forgot.sending") : t("forgot.submit")}
          </button>
        </form>
      )}
    </div>
  );
}
