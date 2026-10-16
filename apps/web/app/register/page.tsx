"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, localizedErrorMessage } from "@/lib/api";
import { useSession } from "@/components/session-provider";
import { useLocale } from "@/components/locale-provider";
import { generateStrongPassword, passwordStrength } from "@/lib/password";
import { EyeIcon, EyeOffIcon, KeyIcon } from "@/components/icons";
import { solveChallenge, type Challenge } from "@/lib/proof-of-work";
import { safeReturnPath } from "@/components/auth-prompt";
import { usePolicyPublished } from "@/components/app-shell";
import { PolicyAgreement } from "@/components/policy-agreement";

export default function RegisterPage() {
  const [inviteCode, setInviteCode] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // The server asks every sign-up for a small proof of work, so that
  // accounts are made in a browser rather than by a script; this is the
  // moment the browser spends on it.
  const [checking, setChecking] = useState(false);
  // "invite" until the server says otherwise: an open sign-up page that
  // briefly asks for a code is harmless, the reverse would let someone
  // start typing a form the server is about to refuse.
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { refresh } = useSession();
  const { t } = useLocale();
  const policy = usePolicyPublished();
  const strength = passwordStrength(password);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ mode: "invite" | "open" }>("/auth/registration")
      .then((res) => {
        if (!cancelled) setOpen(res.mode === "open");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function handleGeneratePassword() {
    // Stays masked like any other password — an operator glancing at a
    // shared screen shouldn't see it just because it was generated
    // rather than typed. The eye toggle is the one way to reveal it.
    setPassword(generateStrongPassword());
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      setChecking(true);
      const { challenge } = await apiFetch<{ challenge: Challenge }>("/auth/register/challenge");
      const nonce = await solveChallenge(challenge);
      setChecking(false);
      await apiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          inviteCode: inviteCode.trim(),
          username,
          email: email || undefined,
          password,
          challengeId: challenge.id,
          nonce,
        }),
      });
      await refresh();
      router.push(safeReturnPath(new URLSearchParams(window.location.search).get("next")) ?? "/dashboard");
    } catch (err) {
      setError(localizedErrorMessage(err, t, "register.failed"));
    } finally {
      setChecking(false);
      setLoading(false);
    }
  }

  return (
    <div className="page-narrow">
      <h1>{t("register.title")}</h1>
      <p className="lede">{t(open ? "register.ledeOpen" : "register.lede")}</p>
      <form className="stack auth-form" onSubmit={handleSubmit}>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-field">
          <label htmlFor="invite">{t(open ? "register.inviteOptional" : "register.invite")}</label>
          <input
            id="invite"
            // Deliberately not `required`: the very first account on a
            // fresh installation is created without a code, and the
            // server is the only thing that knows whether this is it.
            // An empty submission gets a clear message back either way.
            autoComplete="off"
            spellCheck={false}
            placeholder="4TIP-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", letterSpacing: "0.02em" }}
          />
          <span className="meta">{t(open ? "register.inviteHintOpen" : "register.inviteHint")}</span>
        </div>
        <div className="form-field">
          <label htmlFor="username">{t("register.username")}</label>
          <input
            id="username"
            required
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            minLength={3}
            pattern="[a-z0-9_]+"
            title={t("register.usernameHint")}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor="email">{t("register.email")}</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="password">{t("register.password")}</label>
          <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
            <input
              id="password"
              type={passwordVisible ? "text" : "password"}
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
              onClick={handleGeneratePassword}
              aria-label={t("register.generatePassword")}
              title={t("register.generatePassword")}
            >
              <KeyIcon size={18} />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => setPasswordVisible((v) => !v)}
              aria-label={passwordVisible ? t("register.hidePassword") : t("register.showPassword")}
              title={passwordVisible ? t("register.hidePassword") : t("register.showPassword")}
            >
              {passwordVisible ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
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
        <button className="primary" type="submit" disabled={loading}>
          {checking ? t("register.checking") : loading ? t("register.submitting") : t("register.submit")}
        </button>
        {policy && <PolicyAgreement />}
      </form>
    </div>
  );
}
