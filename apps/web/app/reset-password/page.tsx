"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { useLocale } from "@/components/locale-provider";
import { generateStrongPassword, passwordStrength } from "@/lib/password";
import { EyeIcon, EyeOffIcon, KeyIcon } from "@/components/icons";
import { Loading } from "@/components/loading";

function ResetPasswordForm() {
  const { t } = useLocale();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const strength = passwordStrength(password);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/auth/password-reset/confirm", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("reset.error"));
    } finally {
      setBusy(false);
    }
  }

  if (!token) return <div className="error-banner">{t("reset.missingToken")}</div>;

  if (done) {
    return (
      <div className="stack">
        <div className="card">{t("reset.done")}</div>
        <Link href="/login" className="btn-primary" style={{ width: "fit-content" }}>
          {t("nav.signIn")}
        </Link>
      </div>
    );
  }

  return (
    <form className="stack auth-form" onSubmit={handleSubmit}>
      {error && <div className="error-banner">{error}</div>}
      <div className="form-field">
        <label htmlFor="password">{t("reset.password")}</label>
        <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
          <input
            id="password"
            type={visible ? "text" : "password"}
            required
            minLength={10}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="icon-button"
            onClick={() => setPassword(generateStrongPassword())}
            aria-label={t("register.generatePassword")}
            title={t("register.generatePassword")}
          >
            <KeyIcon size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? t("register.hidePassword") : t("register.showPassword")}
            title={visible ? t("register.hidePassword") : t("register.showPassword")}
          >
            {visible ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
          </button>
        </div>
        {password.length > 0 && (
          <div className="password-meter">
            <div
              className="password-meter-track"
              role="progressbar"
              aria-label={t("register.passwordStrength")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(strength.ratio * 100)}
            >
              <div className="password-meter-fill" data-level={strength.label} style={{ width: `${strength.ratio * 100}%` }} />
            </div>
            <span className="meta">
              {t("register.passwordStrength")}: {t(`register.strength.${strength.label}`)}
            </span>
          </div>
        )}
      </div>
      <button className="primary" type="submit" disabled={busy}>
        {busy ? t("reset.saving") : t("reset.submit")}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  const { t } = useLocale();
  return (
    <div className="page-narrow">
      <h1>{t("reset.title")}</h1>
      {/* useSearchParams needs a Suspense boundary to prerender. */}
      <Suspense fallback={<Loading />}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
