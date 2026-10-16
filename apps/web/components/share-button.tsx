"use client";

import { useState } from "react";
import { CheckIcon, ShareIcon } from "./icons";
import { useLocale } from "./locale-provider";

/**
 * Copies a link to the clipboard and says so in place. No share sheet:
 * the Web Share API is unavailable on most desktop browsers, and a
 * button that silently does nothing there is worse than one that always
 * does the same predictable thing.
 *
 * Under a post it is an icon, like its neighbours; the name stays on it
 * for screen readers and on hover, and "copied" appears beside it for a
 * moment rather than resizing the row.
 */
export function ShareButton({ path, variant = "row" }: { path: string; variant?: "row" | "button" | "icon" }) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  const label = t("common.share");

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  if (variant === "button") {
    return (
      <button type="button" className="secondary" onClick={copy} aria-label={label}>
        <ShareIcon size={17} />
        {copied ? t("common.linkCopied") : label}
      </button>
    );
  }

  return (
    <button type="button" className={variant === "icon" ? "profile-action" : "action-item is-icon"} onClick={copy} aria-label={label} title={label}>
      {copied ? <CheckIcon size={17} /> : <ShareIcon size={17} />}
      {copied && (
        <span className="action-toast" role="status">
          {t("common.linkCopied")}
        </span>
      )}
    </button>
  );
}
