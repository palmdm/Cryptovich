"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useLocale } from "./locale-provider";
import { QrCode } from "./qr-code";
import { PhoneIcon } from "./icons";

interface Started {
  id: string;
  number: string;
  expiresAt: string;
}

type Phase = "starting" | "waiting" | "rejected" | "error";

const POLL_MS = 2000;

/**
 * "Sign in from your phone", beside the password form on a computer: a QR
 * code for a phone that is already signed in, and the number that phone
 * must pick. The code renews itself when it runs out; once the phone has
 * answered, this browser collects the session and goes on.
 */
export function QrSignIn({ onSignedIn }: { onSignedIn: () => void | Promise<void> }) {
  const { t } = useLocale();
  const [request, setRequest] = useState<Started | null>(null);
  const [phase, setPhase] = useState<Phase>("starting");
  const busy = useRef(false);

  const start = useCallback(async () => {
    setPhase("starting");
    try {
      setRequest(await apiFetch<Started>("/auth/qr/start", { method: "POST" }));
      setPhase("waiting");
    } catch {
      setPhase("error");
    }
  }, []);

  // Once per page view: React's development mode mounts twice, and every
  // start is a request kept on the server for two minutes.
  const startedOnce = useRef(false);
  useEffect(() => {
    if (startedOnce.current) return;
    startedOnce.current = true;
    start();
  }, [start]);

  useEffect(() => {
    if (!request || phase !== "waiting") return;
    let stopped = false;
    const timer = window.setInterval(async () => {
      if (busy.current || stopped || document.visibilityState !== "visible") return;
      busy.current = true;
      try {
        const { status } = await apiFetch<{ status: string }>(`/auth/qr/${request.id}/status`);
        if (status === "approved") {
          stopped = true;
          await apiFetch(`/auth/qr/${request.id}/claim`, { method: "POST" });
          await onSignedIn();
        } else if (status === "rejected") {
          stopped = true;
          setPhase("rejected");
        } else if (status === "expired") {
          stopped = true;
          start();
        }
      } catch {
        // A missed poll is retried on the next tick.
      } finally {
        busy.current = false;
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [request, phase, start, onSignedIn]);

  const link = request ? `${window.location.origin}/link/${request.id}` : null;

  return (
    <section className="card qr-sign-in" aria-labelledby="qr-sign-in-title">
      <h2 id="qr-sign-in-title">
        <PhoneIcon size={18} />
        {t("qrLogin.title")}
      </h2>
      <p className="meta" style={{ margin: 0 }}>
        {t("qrLogin.hint")}
      </p>
      {phase === "rejected" ? (
        <div className="qr-sign-in-done">
          <p style={{ margin: 0 }}>{t("qrLogin.rejected")}</p>
          <button type="button" className="secondary" onClick={start}>
            {t("qrLogin.again")}
          </button>
        </div>
      ) : phase === "error" ? (
        <div className="qr-sign-in-done">
          <p style={{ margin: 0 }}>{t("qrLogin.error")}</p>
          <button type="button" className="secondary" onClick={start}>
            {t("qrLogin.again")}
          </button>
        </div>
      ) : link && request ? (
        <>
          <QrCode value={link} size={176} alt={t("qrLogin.qrAlt")} />
          <p className="qr-sign-in-number">
            {t("qrLogin.pick")} <strong>{request.number}</strong>
          </p>
        </>
      ) : (
        <div className="qr-sign-in-placeholder" aria-hidden="true" />
      )}
    </section>
  );
}
