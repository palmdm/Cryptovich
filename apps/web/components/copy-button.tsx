"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "./icons";
import { useLocale } from "./locale-provider";

/**
 * An icon that puts `value` on the clipboard and says so beside itself
 * for a moment. Square like its neighbours in an action row, so it can
 * sit next to a code or an address without changing the row's height.
 */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button type="button" className="action-item is-icon" onClick={copy} aria-label={label} title={label}>
      {copied ? <CheckIcon size={17} /> : <CopyIcon size={17} />}
      {copied && (
        <span className="action-toast" role="status">
          {t("common.copied")}
        </span>
      )}
    </button>
  );
}
