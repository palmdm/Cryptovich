"use client";

import { useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { useLocale } from "@/components/locale-provider";
import { LogDialog } from "@/components/log-dialog";
import { StatusPill } from "@/components/status-pill";
import { formatDateTime } from "@/lib/dates";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

interface Delivery {
  id: string;
  kind: "POST" | "PROFILE";
  inbox: string;
  status: "PENDING" | "DELIVERED" | "FAILED";
  retryCount: number;
  lastError: string | null;
  deliveredAt: string | null;
  createdAt: string;
  product: { id: string; title: string } | null;
}

/** Admin → Federation → an author's "Deliveries": what went to which server, and how it went. */
export function DeliveriesDialog({ username, onClose }: { username: string; onClose: () => void }) {
  const { t, locale } = useLocale();
  const load = useCallback(
    async ({ q, filter, cursor }: { q: string; filter: string; cursor: string | null }) => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (filter) params.set("status", filter);
      if (cursor) params.set("cursor", cursor);
      const res = await apiFetch<{ entries: Delivery[]; nextCursor: string | null }>(
        `/admin/federation/creators/${encodeURIComponent(username)}/deliveries?${params}`,
      );
      return { items: res.entries, nextCursor: res.nextCursor };
    },
    [username],
  );

  return (
    <LogDialog<Delivery>
      title={t("federation.deliveriesTitle", { username })}
      filters={[
        { value: "", label: t("log.all") },
        { value: "FAILED", label: t("federation.deliveryStatus.FAILED") },
        { value: "PENDING", label: t("federation.deliveryStatus.PENDING") },
        { value: "DELIVERED", label: t("federation.deliveryStatus.DELIVERED") },
      ]}
      load={load}
      itemKey={(d) => d.id}
      onClose={onClose}
      renderItem={(d) => {
        let host = d.inbox;
        try {
          host = new URL(d.inbox).host;
        } catch {
          /* shown as it is */
        }
        return (
          <div className="log-row">
            <StatusPill prefix="federation.deliveryStatus" status={d.status} />
            <span className="log-row-main">
              <strong>{host}</strong>
              <span className="meta">
                {" · "}
                {d.product ? d.product.title : t(`federation.deliveryKind.${d.kind}` as TranslationKey)}
              </span>
              {d.lastError && <div className="meta">{d.lastError}</div>}
            </span>
            <span className="meta log-row-why">
              {formatDateTime(d.deliveredAt ?? d.createdAt, locale)}
              {d.retryCount > 0 && ` · ${t("federation.deliveryTries", { count: d.retryCount })}`}
            </span>
          </div>
        );
      }}
    />
  );
}
