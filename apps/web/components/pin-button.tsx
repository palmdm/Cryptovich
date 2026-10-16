"use client";

import { useState } from "react";
import { apiFetch, localizedErrorMessage } from "@/lib/api";
import { PinIcon } from "./icons";
import { useLocale } from "./locale-provider";

/**
 * Pins a post to the top of its author's profile, or unpins it. Shown to
 * the author only. The limit (two, five after supporting the server) is
 * the server's to enforce; its refusal comes back as a translated message.
 */
export function PinButton({
  productId,
  pinned,
  onChange,
  onError,
}: {
  productId: string;
  pinned: boolean;
  onChange: (pinned: boolean) => void;
  onError: (message: string | null) => void;
}) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const label = pinned ? t("post.unpin") : t("post.pin");

  async function toggle() {
    setBusy(true);
    onError(null);
    try {
      await apiFetch(`/products/${productId}/pin`, { method: pinned ? "DELETE" : "POST" });
      onChange(!pinned);
    } catch (err) {
      onError(localizedErrorMessage(err, t, "post.pinError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={`action-item is-icon${pinned ? " is-active" : ""}`}
      onClick={toggle}
      disabled={busy}
      aria-pressed={pinned}
      aria-label={label}
      title={label}
    >
      <PinIcon size={17} />
    </button>
  );
}
