"use client";

import { useEffect, useState } from "react";
import { postLength } from "@platform/shared";
import { apiFetch } from "@/lib/api";
import { useLocale } from "./locale-provider";

let cached: Promise<number> | null = null;

/** The server's limit on a post's length (Admin → Parameters), asked once per page. */
export function usePostLimit(): number | null {
  const [max, setMax] = useState<number | null>(null);
  useEffect(() => {
    cached ??= apiFetch<{ maxChars: number }>("/posts/limits")
      .then((res) => res.maxChars)
      .catch(() => {
        cached = null;
        return 0;
      });
    let live = true;
    void cached.then((value) => live && value > 0 && setMax(value));
    return () => {
      live = false;
    };
  }, []);
  return max;
}

/** Whether a text is over the limit — for disabling the publish button. */
export function overLimit(text: string, max: number | null): boolean {
  return max !== null && postLength(text) > max;
}

/**
 * A ring that fills as the text nears the server's limit, the way a
 * fediverse composer's does: quiet until the last tenth, then the number
 * left, then red and negative past it.
 */
export function LengthRing({ text, max }: { text: string; max: number | null }) {
  const { t } = useLocale();
  if (max === null) return null;
  const used = postLength(text);
  const left = max - used;
  const share = Math.min(1, used / max);
  const state = left < 0 ? "over" : left <= max * 0.1 ? "near" : "ok";
  const r = 9;
  const length = 2 * Math.PI * r;
  return (
    <span className={`length-ring is-${state}`} role="status" aria-label={t("editor.charsLeft", { count: left })} title={t("editor.charsLeft", { count: left })}>
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r={r} className="length-ring-track" />
        <circle cx="12" cy="12" r={r} className="length-ring-fill" strokeDasharray={`${share * length} ${length}`} transform="rotate(-90 12 12)" />
      </svg>
      {state !== "ok" && <span className="length-ring-count">{left}</span>}
    </span>
  );
}
