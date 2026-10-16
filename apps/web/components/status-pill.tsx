"use client";

import { useLocale } from "./locale-provider";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

/** The words for a server status — never its enum name — in the colour its outcome deserves. */
const TONE: Record<string, "good" | "wait" | "bad"> = {
  CONFIRMED: "good",
  PUBLISHED: "good",
  APPROVED: "good",
  DONE: "good",
  RESOLVED: "good",
  DELIVERED: "good",
  ADDED: "good",
  SKIPPED: "wait",
  OPEN: "wait",
  REVIEWING: "wait",
  AWAITING_PAYMENT: "wait",
  CREATED: "wait",
  PENDING: "wait",
  RUNNING: "wait",
  REQUESTED: "wait",
  DRAFT: "wait",
  FAILED: "bad",
  EXPIRED: "bad",
  BLOCKED: "bad",
  REJECTED: "bad",
  REVOKED: "bad",
  DISABLED: "bad",
};

/**
 * `prefix` is the dictionary's family for that status — `payments.status`,
 * `product.status`… An unknown value (a status added on the server and not
 * yet here) shows as it came rather than as a missing key.
 */
export function StatusPill({ prefix, status, children }: { prefix: string; status: string; children?: React.ReactNode }) {
  const { t } = useLocale();
  // A key the dictionaries lack comes back undefined.
  const text = t(`${prefix}.${status}` as TranslationKey) as string | undefined;
  return (
    <span className={`status-pill${TONE[status] ? ` is-${TONE[status]}` : ""}`}>
      {text || status}
      {children}
    </span>
  );
}
