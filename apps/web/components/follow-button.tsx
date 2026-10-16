"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { useLocale } from "./locale-provider";
import { useSession } from "./session-provider";
import { useAuthPrompt } from "./auth-prompt";
import { BellIcon, CheckIcon } from "./icons";

/**
 * "Follow": keeping up with an author for free — their new posts in the
 * feed and the notifications, nothing paid opened. One press to follow,
 * one to stop; signed out, the "needs an account" dialog.
 */
export function FollowButton({ username }: { username: string }) {
  const { t } = useLocale();
  const { user } = useSession();
  const { requireAccount } = useAuthPrompt();
  const [following, setFollowing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ following: boolean }>(`/creators/${encodeURIComponent(username)}/follow`)
      .then((res) => setFollowing(res.following))
      .catch(() => setFollowing(false));
  }, [username, user?.id]);

  async function toggle() {
    if (!requireAccount()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ following: boolean }>(`/creators/${encodeURIComponent(username)}/follow`, {
        method: following ? "DELETE" : "POST",
      });
      setFollowing(res.following);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.genericError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={`follow-button ${following ? "secondary is-following" : "primary"}`}
        onClick={toggle}
        disabled={busy || following === null}
        aria-pressed={following === true}
        title={following ? t("follow.unfollowHint") : t("follow.hint")}
      >
        {following ? <CheckIcon size={16} /> : <BellIcon size={16} />}
        {following ? t("follow.following") : t("follow.follow")}
      </button>
      {error && (
        <span className="meta" role="alert" style={{ color: "var(--danger)" }}>
          {error}
        </span>
      )}
    </>
  );
}
