"use client";

import { useEffect, useState } from "react";
import { useLocale } from "./locale-provider";

/**
 * Something is on its way: a turning ring and a word, in place of what is
 * loading. It waits a moment before showing — most loads finish before a
 * spinner would be seen, and one that flashes for a frame reads as a
 * glitch — and it is announced to screen readers as a status.
 */
export function Loading({ label, delayMs = 250, compact = false }: { label?: string; delayMs?: number; compact?: boolean }) {
  const { t } = useLocale();
  const [visible, setVisible] = useState(delayMs === 0);

  useEffect(() => {
    if (delayMs === 0) return;
    const timer = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);

  return (
    <div className={`loading${compact ? " is-compact" : ""}`} role="status" aria-live="polite">
      {visible && (
        <>
          <span className="spinner" aria-hidden="true" />
          <span>{label ?? t("common.loading")}</span>
        </>
      )}
    </div>
  );
}
