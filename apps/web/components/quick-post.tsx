"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { postPathFor } from "@platform/shared";
import { useSession } from "./session-provider";
import { useLocale } from "./locale-provider";
import { CloseIcon, PlusIcon } from "./icons";
import { PostComposer, type PostComposerHandle, type PublishedPost } from "./post-composer";

/** Sent to the feed to bring its composer forward. */
export const COMPOSE_EVENT = "cryptovich:compose";
/** Sent when any composer publishes, so a listing can show the new post. */
export const PUBLISHED_EVENT = "cryptovich:post-published";

/** The width at which the header shows its search box — and the "+" opens the floating editor. */
const DESKTOP = "(min-width: 901px)";

/**
 * "New post" from anywhere. On a computer the header's "+" opens a small
 * editor floating over the page, so a thought can be posted without
 * leaving what is being read; closing it keeps the draft until it is
 * published. On a phone there is no room to float anything: the "+" goes
 * to the feed, whose first item is the full editor, and points at it.
 */
export function useQuickPost() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Mounted on first use and kept, so closing the panel loses no draft.
  const [mounted, setMounted] = useState(false);

  const start = useCallback(() => {
    if (window.matchMedia(DESKTOP).matches) {
      setMounted(true);
      setOpen(true);
      return;
    }
    if (pathname === "/feed") window.dispatchEvent(new Event(COMPOSE_EVENT));
    else router.push("/feed?compose=1");
  }, [pathname, router]);

  return { open, mounted, start, close: () => setOpen(false) };
}

export function QuickPostButton({ onStart, className }: { onStart: () => void; className: string }) {
  const { t } = useLocale();
  return (
    <button type="button" className={className} onClick={onStart} title={t("dashboard.newPost")} aria-label={t("dashboard.newPost")}>
      <PlusIcon size={18} />
    </button>
  );
}

export function QuickPostPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLocale();
  const { user } = useSession();
  const composer = useRef<PostComposerHandle>(null);
  const [published, setPublished] = useState<PublishedPost | null>(null);

  useEffect(() => {
    if (open && !published) composer.current?.focus();
  }, [open, published]);

  if (!user) return null;
  return (
    <section
      className="modal-panel quick-post"
      role="dialog"
      aria-modal="false"
      aria-labelledby="quick-post-title"
      hidden={!open}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="modal-head">
        <h2 id="quick-post-title" style={{ margin: 0 }}>
          {t("dashboard.newPost")}
        </h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label={t("common.close")} title={t("common.close")}>
          <CloseIcon size={18} />
        </button>
      </div>
      {published ? (
        <div className="stack" role="status">
          <p style={{ margin: 0 }}>{t("quickPost.published")}</p>
          <div className="row" style={{ gap: 8 }}>
            <Link href={postPathFor(user.username, published.id)} className="btn-primary" onClick={onClose}>
              {t("quickPost.open")}
            </Link>
            <button type="button" className="secondary" onClick={() => setPublished(null)}>
              {t("quickPost.another")}
            </button>
          </div>
        </div>
      ) : (
        <PostComposer
          ref={composer}
          compact
          onPublished={(post) => {
            setPublished(post);
            window.dispatchEvent(new Event(PUBLISHED_EVENT));
          }}
        />
      )}
    </section>
  );
}
