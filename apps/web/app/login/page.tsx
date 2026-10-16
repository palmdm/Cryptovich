"use client";

import Link from "next/link";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError, localizedErrorMessage } from "@/lib/api";
import { useSession } from "@/components/session-provider";
import { useLocale } from "@/components/locale-provider";
import { safeReturnPath } from "@/components/auth-prompt";
import { QrSignIn } from "@/components/qr-sign-in";
import { FingerprintIcon } from "@/components/icons";
import { cancelledByPerson, passkeysSupported, signInWithPasskey } from "@/lib/webauthn";

export default function LoginPage() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { refresh } = useSession();
  const { t } = useLocale();
  // A computer gets "sign in from your phone"; a phone is the other end of it.
  const [wide, setWide] = useState(false);
  const [passkeys, setPasskeys] = useState(false);
  useEffect(() => {
    setWide(window.matchMedia("(min-width: 761px)").matches);
    setPasskeys(passkeysSupported());
  }, []);

  async function withPasskey() {
    setError(null);
    setLoading(true);
    try {
      await signInWithPasskey();
      await goOn();
    } catch (err) {
      if (!cancelledByPerson(err)) setError(localizedErrorMessage(err, t, "passkeys.signInError"));
    } finally {
      setLoading(false);
    }
  }

  const goOn = useCallback(async () => {
    await refresh();
    // Back to where the sign-in prompt was opened, if it was.
    router.push(safeReturnPath(new URLSearchParams(window.location.search).get("next")) ?? "/dashboard");
  }, [refresh, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({ identifier, password, code: needsCode ? code : undefined }),
      });
      await goOn();
    } catch (err) {
      if (err instanceof ApiError && err.code === "TWO_FACTOR_REQUIRED") {
        setNeedsCode(true);
        setError(null);
      } else {
        setError(localizedErrorMessage(err, t, "login.failed"));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={wide ? "login-layout" : "page-narrow"}>
      <div className="login-main">
      <h1>{t("login.title")}</h1>
      <form className="stack auth-form" onSubmit={handleSubmit}>
        {error && <div className="error-banner">{error}</div>}
        {!needsCode && (
          <>
            <div className="form-field">
              <label htmlFor="identifier">{t("login.identifier")}</label>
              <input
                id="identifier"
                required
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="password">{t("login.password")}</label>
              {/* "current-password" is what tells the browser this is a
                  sign-in: without it Vivaldi and Chrome guessed a new
                  password and offered to generate one here. */}
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </>
        )}
        {needsCode && (
          <div className="form-field">
            <label htmlFor="code">{t("login.code")}</label>
            <input
              id="code"
              required
              maxLength={6}
              autoFocus
              autoComplete="one-time-code"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <span className="lede">{t("login.codeHint")}</span>
          </div>
        )}
        <button className="primary" type="submit" disabled={loading}>
          {loading ? t("login.submitting") : needsCode ? t("login.verify") : t("login.submit")}
        </button>
        {passkeys && !needsCode && (
          <button type="button" className="secondary passkey-sign-in" onClick={withPasskey} disabled={loading}>
            <FingerprintIcon size={18} />
            {t("passkeys.signIn")}
          </button>
        )}
        <Link href="/forgot-password" className="text-link" style={{ fontSize: "0.88rem" }}>
          {t("forgot.link")}
        </Link>
      </form>
      </div>
      {wide && <QrSignIn onSignedIn={goOn} />}
    </div>
  );
}
