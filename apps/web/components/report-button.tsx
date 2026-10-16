"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch, ApiError, localizedErrorMessage } from "@/lib/api";
import { useLocale } from "./locale-provider";
import { useAuthPrompt } from "./auth-prompt";
import { CloseIcon, FlagIcon } from "./icons";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

export type ReportTarget = "CREATOR" | "PRODUCT" | "COMMENT";

const CATEGORIES = ["spam", "scam", "illegal", "harassment", "adult", "copyright", "other"] as const;
type Category = (typeof CATEGORIES)[number];

const TITLE: Record<ReportTarget, TranslationKey> = {
  CREATOR: "report.titleCreator",
  PRODUCT: "report.titlePost",
  COMMENT: "report.titleComment",
};

/**
 * "Report" — an author (by username), a post or a comment (by id). It
 * needs an account, like every action that is someone's: a signed-out
 * reader is offered to sign in. What is sent reaches the administrators
 * only; the author never learns who it was.
 */
export function ReportButton({ target, id, variant = "link" }: { target: ReportTarget; id: string; variant?: "link" | "icon" }) {
  const { t } = useLocale();
  const { requireAccount } = useAuthPrompt();
  const [open, setOpen] = useState(false);
  const label = t("report.action");
  const start = () => requireAccount() && setOpen(true);
  return (
    <>
      {variant === "icon" ? (
        <button type="button" className="action-item is-icon" onClick={start} aria-label={t(TITLE[target])} title={t(TITLE[target])}>
          <FlagIcon size={17} />
        </button>
      ) : (
        <button type="button" className="link-button report-link" onClick={start}>
          <FlagIcon size={14} />
          {label}
        </button>
      )}
      {open && <ReportDialog target={target} id={id} onClose={() => setOpen(false)} />}
    </>
  );
}

function ReportDialog({ target, id, onClose }: { target: ReportTarget; id: string; onClose: () => void }) {
  const { t } = useLocale();
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [category, setCategory] = useState<Category | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setMounted(true);
    const previousFocus = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, [onClose]);

  useEffect(() => {
    if (mounted) panelRef.current?.querySelector<HTMLElement>("input, button")?.focus();
  }, [mounted]);

  const detailsNeeded = category === "other";
  const ready = category !== null && (!detailsNeeded || reason.trim().length >= 5);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      // Sent twice, it is still one report: the server answers the same.
      await apiFetch("/reports", {
        method: "POST",
        body: JSON.stringify({ targetType: target, targetId: id, category, reason: reason.trim() }),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? localizedErrorMessage(err, t, "report.error") : t("report.error"));
    } finally {
      setBusy(false);
    }
  }

  if (!mounted) return null;
  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        ref={panelRef}
        className="modal-panel report-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="report-title" style={{ margin: 0 }}>
            {t(TITLE[target])}
          </h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t("common.close")}>
            <CloseIcon size={18} />
          </button>
        </div>
        {done ? (
          <div className="stack" style={{ gap: 14 }}>
            <p style={{ margin: 0 }} role="status">
              {t("report.sent")}
            </p>
            <button type="button" className="secondary" onClick={onClose}>
              {t("common.close")}
            </button>
          </div>
        ) : (
          <form className="stack" style={{ gap: 14 }} onSubmit={send}>
            <p className="meta" style={{ margin: 0 }}>
              {t("report.lede")}
            </p>
            <fieldset className="report-categories">
              <legend>{t("report.categoryLabel")}</legend>
              {CATEGORIES.map((c) => (
                <label key={c} className="checkbox-row">
                  <input type="radio" name="report-category" value={c} checked={category === c} onChange={() => setCategory(c)} />
                  {t(`report.category.${c}` as TranslationKey)}
                </label>
              ))}
            </fieldset>
            <div className="form-field">
              <label htmlFor="report-reason">{t(detailsNeeded ? "report.detailsRequired" : "report.detailsOptional")}</label>
              <textarea id="report-reason" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            {error && <div className="error-banner">{error}</div>}
            <div className="row" style={{ gap: 8 }}>
              <button type="submit" className="primary" disabled={busy || !ready}>
                {busy ? t("report.sending") : t("report.submit")}
              </button>
              <button type="button" className="secondary" onClick={onClose}>
                {t("common.cancel")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
