"use client";

import type { UploadPhase } from "@/lib/api";
import { useLocale } from "./locale-provider";

/**
 * What an upload is doing, so it never looks frozen.
 *
 * Two phases, because they feel different and take different time: bytes
 * leaving the browser (a real percentage), then the server working on
 * them — an image is resized and re-encoded on arrival, which for a large
 * animation takes a few seconds with nothing to count. That second phase
 * is an indeterminate bar that keeps moving, rather than a bar stuck at
 * 100% that reads as a hang.
 */
export function UploadProgress({ phase }: { phase: UploadPhase | null }) {
  const { t } = useLocale();
  if (!phase) return null;

  const sending = phase.stage === "sending";
  const percent = sending ? Math.round(phase.fraction * 100) : 100;

  return (
    <div className="upload-progress" role="status" aria-live="polite">
      <div
        className={`upload-progress-track${sending ? "" : " is-processing"}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={sending ? percent : undefined}
        aria-label={sending ? t("upload.sending") : t("upload.processing")}
      >
        <div className="upload-progress-bar" style={sending ? { width: `${percent}%` } : undefined} />
      </div>
      <span className="meta">{sending ? t("upload.sendingPercent", { percent }) : t("upload.processing")}</span>
    </div>
  );
}
