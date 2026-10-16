"use client";

import { useState } from "react";
import { apiFetch, localizedErrorMessage } from "@/lib/api";
import { useSession } from "@/components/session-provider";
import { useLocale } from "@/components/locale-provider";
import { LoginHistory } from "@/components/login-history";
import { AuthRequired } from "@/components/auth-prompt";
import { TwoFactorEnrollment } from "@/components/two-factor-enrollment";
import { PasskeySettings } from "@/components/passkey-settings";

export default function SecuritySettingsPage() {
  const { user, refresh } = useSession();
  const { t } = useLocale();
  const [password, setPassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function disable(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetch("/auth/2fa/disable", { method: "POST", body: JSON.stringify({ password, code: disableCode }) });
      setPassword("");
      setDisableCode("");
      await refresh();
    } catch (err) {
      setError(localizedErrorMessage(err, t, "security.disableError"));
    } finally {
      setBusy(false);
    }
  }

  if (!user) return <AuthRequired />;

  return (
    <div className="stack">
      <h1>{t("security.title")}</h1>
      {error && <div className="error-banner">{error}</div>}

      <div className="card stack">
        <h2 style={{ margin: 0 }}>{t("security.twoFactor")}</h2>
        <p className="lede" style={{ margin: 0 }}>
          {t("security.status")}: <strong>{user.twoFactorEnabled ? t("security.enabled") : t("security.disabled")}</strong>
        </p>

        {!user.twoFactorEnabled && <TwoFactorEnrollment onEnabled={refresh} />}

        {user.twoFactorEnabled && (
          <form className="stack" onSubmit={disable}>
            <div className="form-field">
              <label htmlFor="password">{t("login.password")}</label>
              <input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="disableCode">{t("security.currentCode")}</label>
              <input id="disableCode" required maxLength={6} value={disableCode} onChange={(e) => setDisableCode(e.target.value)} />
            </div>
            <button className="secondary" type="submit" disabled={busy}>
              {busy ? t("common.saving") : t("security.disable")}
            </button>
          </form>
        )}
      </div>

      <PasskeySettings />

      <LoginHistory />
    </div>
  );
}
