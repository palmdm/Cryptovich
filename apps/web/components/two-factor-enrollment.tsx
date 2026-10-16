"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, localizedErrorMessage } from "@/lib/api";
import { useLocale } from "./locale-provider";
import { QrCode } from "./qr-code";
import { Loading } from "./loading";

/** "JBSWY3DPEHPK3PXP" as "JBSW Y3DP EHPK 3PXP": easier to type by hand. */
function grouped(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, "$1 ");
}

/**
 * Turning on two-factor sign-in: the QR code for an authenticator app —
 * drawn here in the browser, so the secret goes nowhere else — the same
 * key as text for a phone that cannot scan, and the code that proves it
 * worked. `autoStart` shows the code straight away (the administrators'
 * screen); otherwise it waits for the button.
 */
export function TwoFactorEnrollment({ autoStart = false, onEnabled }: { autoStart?: boolean; onEnabled: () => void | Promise<void> }) {
  const { t } = useLocale();
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const start = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      setSetup(await apiFetch<{ secret: string; otpauthUri: string }>("/auth/2fa/setup", { method: "POST" }));
    } catch (err) {
      setError(localizedErrorMessage(err, t, "security.setupError"));
    } finally {
      setBusy(false);
    }
  }, [t]);

  useEffect(() => {
    // Once: a second setup call would issue a second secret and the QR
    // already scanned would stop matching.
    if (autoStart && !started.current) {
      started.current = true;
      start();
    }
  }, [autoStart, start]);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetch("/auth/2fa/verify", { method: "POST", body: JSON.stringify({ code: code.replace(/\s/g, "") }) });
      setSetup(null);
      setCode("");
      await onEnabled();
    } catch (err) {
      setError(localizedErrorMessage(err, t, "security.codeMismatch"));
    } finally {
      setBusy(false);
    }
  }

  if (!setup) {
    return (
      <div className="stack" style={{ gap: 10 }}>
        {error && <div className="error-banner">{error}</div>}
        {autoStart ? (
          busy || !error ? (
            <Loading />
          ) : (
            <button className="primary" onClick={start} style={{ alignSelf: "flex-start" }}>
              {t("security.retry")}
            </button>
          )
        ) : (
          <button className="primary" onClick={start} disabled={busy} style={{ alignSelf: "flex-start" }}>
            {busy ? t("post.starting") : t("security.enable")}
          </button>
        )}
      </div>
    );
  }

  return (
    <form className="two-factor-enroll" onSubmit={verify}>
      {error && <div className="error-banner">{error}</div>}
      <ol className="two-factor-steps">
        <li>
          <p>{t("security.scanHint")}</p>
          <QrCode value={setup.otpauthUri} size={200} alt={t("security.qrAlt")} />
          <details className="two-factor-manual">
            <summary>{t("security.cantScan")}</summary>
            <code>{grouped(setup.secret)}</code>
          </details>
        </li>
        <li>
          <div className="form-field">
            <label htmlFor="two-factor-code">{t("security.enterCode")}</label>
            <input
              id="two-factor-code"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? t("common.saving") : t("security.confirmEnable")}
          </button>
        </li>
      </ol>
    </form>
  );
}
