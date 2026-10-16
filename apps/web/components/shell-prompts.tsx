"use client";

import { useEffect, useState } from "react";
import { isIosSafari, isStandalone, promptInstall, startPwa } from "@/lib/pwa";
import { enablePush, pushSupported, refreshPush } from "@/lib/push";
import { answerLater, browserNudgeStorage, countVisit, markShown, nudgeAllowed, type Nudge, type NudgeStorage } from "@/lib/nudges";
import { useLocale } from "./locale-provider";
import { useSession } from "./session-provider";
import { useCanInstall } from "./install-banner";
import { BellIcon, CloseIcon, DownloadIcon } from "./icons";

/** Not the moment a page opens: a reader who stays a while is asked. */
const DELAY_MS = 20_000;

/**
 * The two offers — install Cryptovich as an app, turn on browser notifications —
 * as one slim line in the corner, one at a time, from a reader's second
 * visit, and kept away by "Later" (see lib/nudges.ts for the rules). The
 * browser's own permission dialog still comes only from the button.
 *
 * It also re-tells the server about an existing push subscription on each
 * load, so it follows whoever is signed in here and their language.
 */
export function ShellPrompts() {
  const { t, locale } = useLocale();
  const { user } = useSession();
  const installable = useCanInstall();
  const [store, setStore] = useState<NudgeStorage | null>(null);
  const [ready, setReady] = useState(false);
  const [ios, setIos] = useState(false);
  const [askPush, setAskPush] = useState(false);
  const [current, setCurrent] = useState<Nudge | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    startPwa();
    const storage = browserNudgeStorage();
    setStore(storage);
    if (storage) countVisit(storage);
    setIos(isIosSafari());
    const timer = window.setTimeout(() => setReady(true), DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!user || !pushSupported()) {
      setAskPush(false);
      return;
    }
    void refreshPush(locale);
    setAskPush(Notification.permission === "default");
  }, [user, locale]);

  // Chosen once per page view, and then left alone.
  useEffect(() => {
    if (!ready || !store || current || done) return;
    const now = Date.now();
    const pick: Nudge | null =
      askPush && nudgeAllowed(store, "push", now)
        ? "push"
        : (installable || ios) && !isStandalone() && nudgeAllowed(store, "install", now)
          ? "install"
          : null;
    if (pick) {
      markShown(store, pick);
      setCurrent(pick);
    }
  }, [ready, store, askPush, installable, ios, current, done]);

  if (!current) return null;

  function close(later: boolean) {
    if (later && store && current) answerLater(store, current, Date.now());
    setCurrent(null);
    setDone(true);
  }

  async function accept() {
    if (current === "push") {
      await enablePush(locale).catch(() => "off");
      close(false);
    } else if (installable) {
      // Turning the browser's own dialog down counts as "Later".
      close(!(await promptInstall()));
    } else {
      close(true);
    }
  }

  const text = current === "push" ? t("push.promptTitle") : installable ? t("nudge.install") : t("pwa.iosHint");
  const action = current === "push" ? t("push.enable") : installable ? t("pwa.install") : null;

  return (
    <div className="shell-prompts">
      <div className="nudge" role="region" aria-label={current === "push" ? t("push.title") : t("pwa.title")}>
        <span className="nudge-icon" aria-hidden="true">
          {current === "push" ? <BellIcon size={16} /> : <DownloadIcon size={16} />}
        </span>
        <span className="nudge-text">{text}</span>
        {action && (
          <button type="button" className="nudge-action" onClick={accept}>
            {action}
          </button>
        )}
        <button type="button" className="nudge-later" onClick={() => close(true)}>
          {t("nudge.later")}
        </button>
        <button type="button" className="nudge-close" onClick={() => close(true)} aria-label={t("common.close")} title={t("common.close")}>
          <CloseIcon size={14} />
        </button>
      </div>
    </div>
  );
}
