"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { useLocale } from "@/components/locale-provider";
import { DataTable, type Column, type Filter } from "@/components/data-table";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { Loading } from "@/components/loading";
import { StatusPill } from "@/components/status-pill";

interface AccessRequest {
  id: string;
  status: "REQUESTED" | "APPROVED" | "REJECTED" | "REVOKED";
  amountMinor: string;
  currency: string;
  note: string | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  user: { id: string; username: string; email: string | null; role: string; canUploadFiles: boolean };
}

/**
 * The queue an administrator works: someone asked for API access and says
 * they sent a contribution. Approving mints the key and returns it once —
 * it is shown here, and never again, so it has to be copied and passed on
 * before the panel is dismissed.
 */
export function ApiAccessTab() {
  const { t, locale } = useLocale();
  const [requests, setRequests] = useState<AccessRequest[] | null>(null);
  const [mintedFor, setMintedFor] = useState<{ username: string; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRequests((await apiFetch<{ requests: AccessRequest[] }>("/admin/api-access")).requests);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("admin.loadError"));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function review(row: AccessRequest, decision: "APPROVED" | "REJECTED") {
    setBusyId(row.id);
    setError(null);
    try {
      const res = await apiFetch<{ token: string | null }>(`/admin/api-access/${row.id}/review`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      });
      if (res.token) setMintedFor({ username: row.user.username, token: res.token });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("admin.loadError"));
    } finally {
      setBusyId(null);
    }
  }

  async function revoke(row: AccessRequest) {
    setBusyId(row.id);
    setError(null);
    try {
      await apiFetch(`/admin/api-access/${row.id}/revoke`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("admin.loadError"));
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<AccessRequest>[] = [
    {
      key: "user",
      label: t("admin.tabUsers"),
      value: (r) => r.user.username,
      render: (r) => (
        <span>
          @{r.user.username}
          <div className="meta">{r.user.role}</div>
        </span>
      ),
    },
    {
      key: "email",
      label: t("admin.contact"),
      value: (r) => r.user.email ?? "",
      render: (r) =>
        // Email exists for exactly two reasons: signing in, and letting an
        // administrator reach the person. Where none was given, say so
        // rather than rendering an empty cell.
        r.user.email ? (
          <a className="text-link" href={`mailto:${r.user.email}`}>
            {r.user.email}
          </a>
        ) : (
          <span className="meta">{t("admin.noEmail")}</span>
        ),
    },
    {
      key: "amount",
      label: t("admin.apiAmount"),
      value: (r) => Number(r.amountMinor),
      align: "right",
      render: (r) => <span className="price-tag">{formatMoney(r.amountMinor, r.currency)}</span>,
    },
    {
      key: "note",
      label: t("admin.apiNote"),
      value: (r) => r.note ?? "",
      render: (r) => <span className="meta">{r.note ?? "—"}</span>,
    },
    {
      key: "status",
      label: t("form.status"),
      value: (r) => r.status,
      render: (r) => (
        <StatusPill prefix="apiAccess.status" status={r.status}>
          {r.reviewedBy && <span className="meta"> · @{r.reviewedBy}</span>}
        </StatusPill>
      ),
    },
    {
      key: "created",
      label: t("admin.created"),
      value: (r) => r.createdAt,
      render: (r) => <span className="meta">{formatDateTime(r.createdAt, locale)}</span>,
    },
    {
      key: "actions",
      label: t("admin.actions"),
      align: "right",
      render: (r) => (
        <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
          {r.status === "REQUESTED" && (
            <>
              <button className="primary" disabled={busyId === r.id} onClick={() => review(r, "APPROVED")}>
                {t("admin.apiApprove")}
              </button>
              <button className="secondary" disabled={busyId === r.id} onClick={() => review(r, "REJECTED")}>
                {t("admin.apiReject")}
              </button>
            </>
          )}
          {r.status === "APPROVED" && (
            <button className="danger" disabled={busyId === r.id} onClick={() => revoke(r)}>
              {t("admin.apiRevoke")}
            </button>
          )}
        </div>
      ),
    },
  ];

  const filters: Filter<AccessRequest>[] = [
    {
      key: "status",
      label: t("admin.filterStatus"),
      options: ["REQUESTED", "APPROVED", "REJECTED", "REVOKED"].map((s) => ({ value: s, label: s })),
      matches: (row, value) => row.status === value,
    },
  ];

  return (
    <div className="stack" style={{ gap: 12 }}>
      {error && <div className="error-banner">{error}</div>}

      {mintedFor && (
        <div className="card stack" style={{ gap: 8 }}>
          <strong>@{mintedFor.username}</strong>
          <span className="meta">{t("admin.apiKeyOnce")}</span>
          <code style={{ wordBreak: "break-all", padding: "10px 12px", display: "block" }}>{mintedFor.token}</code>
          <button className="secondary" onClick={() => setMintedFor(null)} style={{ width: "fit-content" }}>
            {t("common.cancel")}
          </button>
        </div>
      )}

      {requests === null ? (
        <Loading />
      ) : (
        <DataTable
          rows={requests}
          columns={columns}
          filters={filters}
          getRowKey={(r) => r.id}
          initialSort={{ key: "created", direction: "desc" }}
          emptyLabel={t("admin.apiEmpty")}
        />
      )}
    </div>
  );
}
