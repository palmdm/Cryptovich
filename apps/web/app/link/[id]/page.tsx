"use client";

import { use, useEffect, useState } from "react";
import { apiFetch, ApiError, localizedErrorMessage } from "@/lib/api";
import { useLocale } from "@/components/locale-provider";
import { useSession } from "@/components/session-provider";
import { AuthRequired } from "@/components/auth-prompt";
import { Loading } from "@/components/loading";
import { MonitorIcon, CheckIcon } from "@/components/icons";

interface Request {
  device: { browser: string | null; os: string | null; kind: string };
  requestedAt: string;
  choices: string[];
}

type Step = "pick" | "trust" | "done" | "gone" | "cancelled";

/**
 * The phone's side of "sign in from your phone": which device is asking,
 * the number to match with its screen, and whether it is the reader's own
 * computer or a temporary sign-in that ends when its browser closes.
 */
export default function LinkDevicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, loading } = useSession();
  const { t } = useLocale();
  const [request, setRequest] = useState<Request | null>(null);
  const [step, setStep] = useState<Step>("pick");
  const [number, setNumber] = useState<string | null>(null);
  const [temporary, setTemporary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    apiFetch<Request>(`/auth/qr/${encodeURIComponent(id)}`)
      .then(setRequest)
      .catch(() => setStep("gone"));
  }, [id, user]);

  if (loading) return <Loading />;
  if (!user) return <AuthRequired />;

  async function approve(asTemporary: boolean) {
    if (!number) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/auth/qr/${encodeURIComponent(id)}/approve`, {
        method: "POST",
        body: JSON.stringify({ number, temporary: asTemporary }),
      });
      setTemporary(asTemporary);
      setStep("done");
    } catch (err) {
      if (err instanceof ApiError && err.code === "QR_NUMBER_MISMATCH") setStep("cancelled");
      else if (err instanceof ApiError && err.status === 404) setStep("gone");
      else setError(localizedErrorMessage(err, t, "qrLogin.error"));
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    await apiFetch(`/auth/qr/${encodeURIComponent(id)}/reject`, { method: "POST" }).catch(() => undefined);
    setBusy(false);
    setStep("cancelled");
  }

  const device = request ? [request.device.browser, request.device.os].filter(Boolean).join(" · ") || t("security.unknownDevice") : "";

  return (
    <div className="page-narrow link-device">
      <h1>{t("qrLogin.phoneTitle")}</h1>
      {error && <div className="error-banner">{error}</div>}

      {step === "gone" && <div className="empty-state">{t("qrLogin.gone")}</div>}
      {step === "cancelled" && <div className="empty-state">{t("qrLogin.cancelled")}</div>}
      {step === "done" && (
        <div className="card link-device-done" role="status">
          <CheckIcon size={22} />
          <p style={{ margin: 0 }}>{temporary ? t("qrLogin.doneTemporary") : t("qrLogin.done")}</p>
        </div>
      )}

      {(step === "pick" || step === "trust") && !request && <Loading />}

      {(step === "pick" || step === "trust") && request && (
        <div className="card stack" style={{ gap: 14 }}>
          <div className="link-device-who">
            <MonitorIcon size={28} />
            <div>
              <strong>{device}</strong>
              <div className="meta">{t("qrLogin.asking")}</div>
            </div>
          </div>
          <p className="meta" style={{ margin: 0 }}>
            {t("qrLogin.warning")}
          </p>

          {step === "pick" && (
            <>
              <p style={{ margin: 0 }}>
                <strong>{t("qrLogin.whichNumber")}</strong>
              </p>
              <div className="link-device-numbers" role="group" aria-label={t("qrLogin.whichNumber")}>
                {request.choices.map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    className="link-device-number"
                    onClick={() => {
                      setNumber(choice);
                      setStep("trust");
                    }}
                  >
                    {choice}
                  </button>
                ))}
              </div>
              <button type="button" className="link-button" onClick={reject} disabled={busy}>
                {t("qrLogin.notMe")}
              </button>
            </>
          )}

          {step === "trust" && (
            <>
              <p style={{ margin: 0 }}>
                <strong>{t("qrLogin.trustQuestion")}</strong>
              </p>
              <div className="stack" style={{ gap: 8 }}>
                <button type="button" className="primary" disabled={busy} onClick={() => approve(false)}>
                  {t("qrLogin.trustYes")}
                </button>
                <button type="button" className="secondary" disabled={busy} onClick={() => approve(true)}>
                  {t("qrLogin.trustTemporary")}
                </button>
              </div>
              <p className="meta" style={{ margin: 0 }}>
                {t("qrLogin.temporaryHint")}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
