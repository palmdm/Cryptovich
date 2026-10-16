"use client";

import { useId, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useLocale } from "./locale-provider";

// One lookup per name per page load, shared by every place that shows it —
// a thread with thirty comments from three people asks three times.
const inviterCache = new Map<string, Promise<string | null>>();

function inviterOf(username: string): Promise<string | null> {
  let hit = inviterCache.get(username);
  if (!hit) {
    hit = apiFetch<{ invitedBy: string | null }>(`/users/${encodeURIComponent(username)}/invited-by`)
      .then((res) => res.invitedBy)
      .catch(() => {
        // A failed lookup must not stick: forget it so the next hover retries.
        inviterCache.delete(username);
        return null;
      });
    inviterCache.set(username, hit);
  }
  return hit;
}

/**
 * `@username`, and on hover or keyboard focus a small note saying who
 * invited this account — nothing at all for an account nobody invited, so
 * most names look exactly as they did. The lookup waits for the first
 * hover: a page of names is not a page of requests.
 */
export function Username({
  username,
  className,
  focusable = false,
}: {
  username: string;
  className?: string;
  /** A tab stop for keyboard readers — leave it off inside a link, which is already one. */
  focusable?: boolean;
}) {
  const { t } = useLocale();
  const id = useId();
  const [inviter, setInviter] = useState<string | null>(null);

  function load() {
    inviterOf(username).then(setInviter);
  }

  return (
    <span
      className={`username-tip${className ? ` ${className}` : ""}`}
      tabIndex={focusable ? 0 : undefined}
      aria-describedby={inviter ? id : undefined}
      onMouseEnter={load}
      onFocus={load}
      onTouchStart={load}
    >
      @{username}
      {inviter && (
        <span id={id} role="tooltip" className="username-tip-bubble">
          {t("user.invitedBy")} @{inviter}
        </span>
      )}
    </span>
  );
}
