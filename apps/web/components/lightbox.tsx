"use client";

import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "./icons";
import { useLocale } from "./locale-provider";

export interface LightboxImage {
  src: string;
  alt: string;
}

const SWIPE_PX = 48;

/**
 * A picture at the size of the screen. Opened by clicking a picture in a
 * card or a post; closed by Esc, the backdrop, the button or (on a phone)
 * a swipe down; ← → and a horizontal swipe move between the pictures.
 *
 * It only ever shows the `src` it is handed — addresses the page already
 * has, and every one of them goes through the gated download route — so
 * opening it cannot reveal a picture the reader could not already see.
 */
export function Lightbox({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: LightboxImage[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const closeRef = useRef<HTMLButtonElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const count = images.length;
  const current = images[index];

  const step = useCallback(
    (delta: number) => {
      if (count > 1) onIndexChange((index + delta + count) % count);
    },
    [count, index, onIndexChange],
  );

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    // The page behind must not scroll while a picture is open.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, step]);

  if (!current || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={t("gallery.viewer")}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const from = start.current;
        start.current = null;
        if (!from) return;
        const dx = e.clientX - from.x;
        const dy = e.clientY - from.y;
        if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) step(dx > 0 ? -1 : 1);
        else if (dy > SWIPE_PX * 2 && Math.abs(dy) > Math.abs(dx)) onClose();
      }}
    >
      <button ref={closeRef} type="button" className="lightbox-close" onClick={onClose} aria-label={t("gallery.close")}>
        <CloseIcon size={22} />
      </button>

      {count > 1 && (
        <button type="button" className="lightbox-nav is-prev" onClick={() => step(-1)} aria-label={t("gallery.prev")}>
          <span aria-hidden="true">‹</span>
        </button>
      )}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="lightbox-image" src={current.src} alt={current.alt} draggable={false} />

      {count > 1 && (
        <button type="button" className="lightbox-nav is-next" onClick={() => step(1)} aria-label={t("gallery.next")}>
          <span aria-hidden="true">›</span>
        </button>
      )}

      {count > 1 && (
        <span className="lightbox-count" aria-live="polite">
          {index + 1} / {count}
        </span>
      )}
    </div>,
    document.body,
  );
}
