"use client";

import { useSession } from "./session-provider";
import { useLocale } from "./locale-provider";
import { TwoFactorEnrollment } from "./two-factor-enrollment";
import { ShieldIcon } from "./icons";
import { apiFetch } from "@/lib/api";

/**
 * An administrator without a second factor sees this in place of every
 * page — the QR code straight away — until it is on. The API refuses the
 * admin area to them anyway; this makes the way out the only thing shown.
 */
export function AdminTwoFactorGate({ children }: { children: React.ReactNode }) {
  const { user, refresh } = useSession();
  const { t } = useLocale();
  if (!user?.twoFactorSetupRequired) return <>{children}</>;

  async function signOut() {
    await apiFetch("/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/";
  }

  return (
    <section className="card stack admin-two-factor" aria-labelledby="admin-two-factor-title">
      <div className="admin-two-factor-head">
        <ShieldIcon size={28} />
        <h1 id="admin-two-factor-title" style={{ margin: 0 }}>
          {t("adminTwoFactor.title")}
        </h1>
      </div>
      <p className="lede" style={{ margin: 0 }}>
        {t("adminTwoFactor.text")}
      </p>
      <TwoFactorEnrollment autoStart onEnabled={refresh} />
      <p className="meta" style={{ margin: 0 }}>
        {t("adminTwoFactor.recovery")}{" "}
        <button type="button" className="link-button" onClick={signOut}>
          {t("nav.signOut")}
        </button>
      </p>
    </section>
  );
}
