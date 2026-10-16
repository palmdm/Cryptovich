"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { BookmarkIcon } from "./icons";
import { useLocale } from "./locale-provider";
import { useAuthPrompt } from "./auth-prompt";

/**
 * Save / unsave a post — the same icon on a card and on the post page, so
 * a post can be kept without being opened. A bookmark is a private list,
 * so a signed-out reader is asked to sign in when they press it.
 */
export function BookmarkButton({
  productId,
  initial,
  onChange,
}: {
  productId: string;
  initial: boolean;
  onChange?: (bookmarked: boolean) => void;
}) {
  const { t } = useLocale();
  const { requireAccount } = useAuthPrompt();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);

  useEffect(() => setOn(initial), [initial]);

  const label = on ? t("post.bookmarked") : t("post.bookmark");

  async function toggle() {
    if (busy || !requireAccount()) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ bookmarked: boolean }>(`/products/${productId}/bookmark`, { method: "POST" });
      setOn(res.bookmarked);
      onChange?.(res.bookmarked);
    } catch {
      // The icon staying as it was is the feedback — the same reasoning as
      // a failed reaction, not a banner over a list being read.
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={`action-item is-icon is-bookmark${on ? " is-active" : ""}`}
      onClick={toggle}
      disabled={busy}
      aria-pressed={on}
      aria-label={label}
      title={label}
    >
      <BookmarkIcon size={17} />
    </button>
  );
}
