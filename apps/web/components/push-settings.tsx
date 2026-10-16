"use client";

import { useEffect, useState } from "react";
import { disablePush, enablePush, pushState, type PushState } from "@/lib/push";
import { notificationSoundOn, playNotificationSound, setNotificationSoundOn } from "@/lib/notification-sound";
import { useLocale } from "./locale-provider";
import { BellIcon } from "./icons";

/**
 * Turning browser notifications on or off for this browser. Permission is
 * asked only from the button — a site that asks on load gets blocked by
 * the browser and by the reader alike.
 */
export function PushSettings() {
  const { t, locale } = useLocale();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sound, setSound] = useState(true);

  useEffect(() => {
    pushState().then(setState).catch(() => setState("unsupported"));
    setSound(notificationSoundOn());
  }, []);

  function toggleSound(on: boolean) {
    setNotificationSoundOn(on);
    setSound(on);
    // Turning it on plays it once, so the reader knows what to listen for.
    if (on) playNotificationSound("notification");
  }

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      setState(state === "on" ? await disablePush() : await enablePush(locale));
    } catch {
      setError(t("push.error"));
    } finally {
      setBusy(false);
    }
  }

  if (state === null) return null;

  const status =
    state === "on" ? t("push.on") : state === "denied" ? t("push.denied") : state === "unsupported" ? t("push.unsupported") : t("push.off");

  return (
    <section className="card push-settings" aria-labelledby="push-settings-title">
      <span className="push-settings-icon" aria-hidden="true">
        <BellIcon size={20} />
      </span>
      <div className="push-settings-text">
        <h2 id="push-settings-title">{t("push.title")}</h2>
        <p className="meta">{t("push.lede")}</p>
        <p className="meta" role="status">
          {status}
        </p>
        {error && <div className="error-banner">{error}</div>}
        <label className="notification-sound">
          <input type="checkbox" checked={sound} onChange={(e) => toggleSound(e.target.checked)} />
          <span>
            {t("push.sound")}
            <span className="meta">{t("push.soundHint")}</span>
          </span>
        </label>
        {/* To hear them now — and to know the browser plays sound at all. */}
        <div className="row notification-sound-try" style={{ gap: 6 }}>
          <button type="button" className="secondary" onClick={() => playNotificationSound("notification")}>
            {t("push.trySound")}
          </button>
          <button type="button" className="secondary" onClick={() => playNotificationSound("payment")}>
            {t("push.tryPaymentSound")}
          </button>
        </div>
      </div>
      {(state === "on" || state === "off") && (
        <button type="button" className={state === "on" ? "secondary" : "primary"} onClick={toggle} disabled={busy}>
          {state === "on" ? t("push.disable") : t("push.enable")}
        </button>
      )}
    </section>
  );
}
