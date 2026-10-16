"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { useSession } from "@/components/session-provider";
import { useLocale } from "@/components/locale-provider";
import { formatMoney } from "@/lib/money";
import { DataTable } from "@/components/data-table";
import { SettingsShell, SettingsScroller, type SettingsSection } from "@/components/settings-shell";
import { CopyButton } from "@/components/copy-button";
import {
  GridIcon,
  KeyIcon,
  ShieldIcon,
  UsersIcon,
  PackageIcon,
  FileTextIcon,
  BroadcastIcon,
  SlidersIcon, MegaphoneIcon, StickerIcon,
  TableIcon,
} from "@/components/icons";
import { ApiAccessTab } from "./api-access-tab";
import { AnnouncementsTab } from "./announcements-tab";
import { StickersTab } from "./stickers-tab";
import { ParametersTab } from "./parameters-tab";
import { Username } from "@/components/username";
import { formatDate, formatDateTime } from "@/lib/dates";
import { Loading } from "@/components/loading";
import { StatusPill } from "@/components/status-pill";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { AuditTab } from "./audit-tab";
import { DeliveriesDialog } from "./deliveries-dialog";

interface Report {
  id: string;
  targetType: string;
  targetId: string;
  category: string | null;
  reason: string;
  status: string;
  createdAt: string;
  reporterUsername: string | null;
  /** What the report is about; null once it is gone. */
  target: { label: string; path: string; author: string } | null;
}

interface AdminUser {
  id: string;
  username: string;
  email: string | null;
  role: string;
  suspendedAt: string | null;
  createdAt: string;
  canUploadFiles: boolean;
}

interface AdminProduct {
  id: string;
  title: string;
  slug: string;
  type: string;
  status: string;
  creator: { user: { username: string } };
}

interface AdminPayment {
  id: string;
  status: string;
  purpose: string;
  amountMinor: string;
  currency: string;
  createdAt: string;
}

interface FederatedCreatorRow {
  username: string;
  displayName: string;
  enabled: boolean;
  hasActor: boolean;
}

interface FederationInstanceRow {
  id: string;
  domain: string;
  platform: string;
  status: "PENDING" | "APPROVED" | "BLOCKED";
}

interface Invite {
  id: string;
  code: string;
  note: string | null;
  maxUses: number | null;
  usedCount: number;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  issuedBy: string | null;
}

interface Stats {
  users: number;
  suspended: number;
  authors: number;
  publishedPosts: number;
  confirmedPayments: number;
  openReports: number;
  unusedInvites: number;
}

const TABS = ["overview", "settings", "parameters", "announcements", "stickers", "apiAccess", "reports", "users", "products", "payments", "invites", "federation", "audit"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABEL_KEYS = {
  overview: "admin.tabOverview",
  settings: "admin.tabSettings",
  parameters: "admin.tabParameters",
  announcements: "admin.tabAnnouncements",
  stickers: "admin.tabStickers",
  apiAccess: "admin.tabApiAccess",
  reports: "admin.tabReports",
  users: "admin.tabUsers",
  products: "admin.tabProducts",
  payments: "admin.tabPayments",
  invites: "admin.tabInvites",
  federation: "admin.tabFederation",
  audit: "admin.tabAudit",
} as const;

/**
 * Which group each section sits under in the sidebar. Nine tabs in a row
 * needed horizontal scrolling to fit; nine list entries under three
 * headings simply read as a list.
 */
const TAB_GROUP_KEYS = {
  overview: "admin.groupOverview",
  settings: "admin.groupServer",
  parameters: "admin.groupServer",
  announcements: "admin.groupServer",
  stickers: "admin.groupServer",
  apiAccess: "admin.groupPeople",
  reports: "admin.groupModeration",
  users: "admin.groupPeople",
  products: "admin.groupModeration",
  payments: "admin.groupModeration",
  invites: "admin.groupPeople",
  federation: "admin.groupServer",
  audit: "admin.groupServer",
} as const;

const TAB_ICONS: Record<Tab, (props: { size?: number }) => React.ReactElement> = {
  overview: GridIcon,
  settings: SlidersIcon,
  parameters: TableIcon,
  announcements: MegaphoneIcon,
  stickers: StickerIcon,
  apiAccess: KeyIcon,
  reports: ShieldIcon,
  users: UsersIcon,
  products: PackageIcon,
  payments: SlidersIcon,
  invites: FileTextIcon,
  federation: BroadcastIcon,
  audit: FileTextIcon,
};

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="meta">{label}</div>
      <div className="price-tag" style={{ fontSize: "1.6rem", marginTop: 4 }}>
        {value}
      </div>
    </div>
  );
}

function InviteManager() {
  const { t } = useLocale();
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [note, setNote] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setInvites((await apiFetch<{ invites: Invite[] }>("/admin/invites")).invites);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("admin.loadError"));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ invite: Invite }>("/admin/invites", {
        method: "POST",
        body: JSON.stringify({
          note: note.trim() || undefined,
          // An empty field means unlimited, which the API expresses as null.
          maxUses: maxUses === "" ? null : Number(maxUses),
          expiresInDays: expiresInDays === "" ? null : Number(expiresInDays),
        }),
      });
      setCreated(res.invite.code);
      setNote("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("admin.loadError"));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setError(null);
    try {
      await apiFetch(`/admin/invites/${id}/revoke`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("admin.loadError"));
    }
  }

  function state(invite: Invite): string {
    if (invite.revokedAt) return t("admin.inviteRevoked");
    if (invite.expiresAt && new Date(invite.expiresAt) <= new Date()) return t("admin.inviteExpired");
    if (invite.maxUses !== null && invite.usedCount >= invite.maxUses) return t("admin.inviteExhausted");
    return t("admin.inviteActive");
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      {error && <div className="error-banner">{error}</div>}

      <form className="card stack" style={{ gap: 12 }} onSubmit={create}>
        <h2>{t("admin.newInvite")}</h2>
        <div className="row" style={{ gap: 12, alignItems: "flex-end" }}>
          <div className="form-field" style={{ flex: 2, minWidth: 180 }}>
            <label htmlFor="note">{t("admin.inviteNote")}</label>
            <input id="note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="form-field" style={{ flex: 1, minWidth: 120 }}>
            <label htmlFor="maxUses">{t("admin.inviteMaxUses")}</label>
            <input
              id="maxUses"
              type="number"
              min={1}
              max={1000}
              value={maxUses}
              placeholder={t("admin.inviteUnlimited")}
              onChange={(e) => setMaxUses(e.target.value)}
            />
          </div>
          <div className="form-field" style={{ flex: 1, minWidth: 120 }}>
            <label htmlFor="expiry">{t("admin.inviteExpiry")}</label>
            <input
              id="expiry"
              type="number"
              min={1}
              max={365}
              value={expiresInDays}
              placeholder={t("admin.inviteNever")}
              onChange={(e) => setExpiresInDays(e.target.value)}
            />
          </div>
        </div>
        <button className="primary" type="submit" disabled={busy} style={{ alignSelf: "flex-start" }}>
          {busy ? t("common.saving") : t("admin.newInvite")}
        </button>

        {created && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="meta">{t("admin.inviteCreated")}</span>
            <div className="invite-code-row">
              <code className="invite-code is-large">{created}</code>
              <CopyButton value={created} label={t("admin.inviteCopy")} />
            </div>
          </div>
        )}
      </form>

      {invites === null && <Loading />}
      {invites?.length === 0 && <div className="empty-state">{t("admin.inviteEmpty")}</div>}
      {invites && invites.length > 0 && (
          <SettingsScroller><table className="data-table">
            <tbody>
              {invites.map((i) => (
                <tr key={i.id}>
                  <td>
                    <div className="invite-code-row">
                      <code className="invite-code">{i.code}</code>
                      <CopyButton value={i.code} label={t("admin.inviteCopy")} />
                    </div>
                    {i.note && <div className="meta">{i.note}</div>}
                  </td>
                  <td>
                    <span className="status-pill">{state(i)}</span>
                  </td>
                  <td className="meta">
                    {i.usedCount}
                    {i.maxUses === null ? " / ∞" : ` / ${i.maxUses}`} {t("admin.inviteUsed")}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {!i.revokedAt && (
                      <button className="danger" onClick={() => revoke(i.id)}>
                        {t("admin.inviteRevoke")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></SettingsScroller>
      )}
    </div>
  );
}

export default function AdminPage() {
  const { user, loading } = useSession();
  const { t, locale } = useLocale();
  const [tab, setTab] = useState<Tab>("overview");
  const [deliveriesFor, setDeliveriesFor] = useState<string | null>(null);
  // `/admin?tab=reports` — where a "new report" notification leads.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("tab");
    if (wanted && (TABS as readonly string[]).includes(wanted)) setTab(wanted as Tab);
  }, []);
  const [stats, setStats] = useState<Stats | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [instances, setInstances] = useState<FederationInstanceRow[]>([]);
  const [serverSettings, setServerSettings] = useState<Record<string, string> | null>(null);
  const [fedCreators, setFedCreators] = useState<FederatedCreatorRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      if (tab === "overview") setStats((await apiFetch<{ stats: Stats }>("/admin/stats")).stats);
      // The API access queue owns its own fetching.
      if (tab === "reports") setReports((await apiFetch<{ reports: Report[] }>("/admin/reports")).reports);
      if (tab === "users") setUsers((await apiFetch<{ users: AdminUser[] }>("/admin/users")).users);
      if (tab === "products") setProducts((await apiFetch<{ products: AdminProduct[] }>("/admin/products")).products);
      if (tab === "payments") setPayments((await apiFetch<{ payments: AdminPayment[] }>("/admin/payments")).payments);
      if (tab === "settings") setServerSettings((await apiFetch<{ settings: Record<string, string> }>("/admin/settings")).settings);
      if (tab === "federation") {
        const [instanceList, creatorList, settings] = await Promise.all([
          apiFetch<{ instances: FederationInstanceRow[] }>("/admin/federation/instances"),
          apiFetch<{ creators: FederatedCreatorRow[] }>("/admin/federation/creators"),
          apiFetch<{ settings: Record<string, string> }>("/admin/settings"),
        ]);
        setInstances(instanceList.instances);
        setFedCreators(creatorList.creators);
        setServerSettings(settings.settings);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("admin.loadError"));
    }
  }, [tab, t]);

  useEffect(() => {
    if (user?.role === "ADMIN") load();
  }, [user, load]);

  async function resolveReport(id: string, status: string) {
    await apiFetch(`/admin/reports/${id}/resolve`, { method: "POST", body: JSON.stringify({ status }) });
    await load();
  }

  async function setProductDisabled(id: string, disable: boolean) {
    await apiFetch(`/admin/products/${id}/${disable ? "disable" : "enable"}`, { method: "POST" });
    await load();
  }

  async function toggleSuspend(u: AdminUser) {
    if (u.suspendedAt) {
      await apiFetch(`/admin/users/${u.id}/restore`, { method: "POST" });
    } else {
      const reason = window.prompt(t("admin.suspendReason"));
      if (!reason) return;
      await apiFetch(`/admin/users/${u.id}/suspend`, { method: "POST", body: JSON.stringify({ reason }) });
    }
    await load();
  }

  async function setUploads(u: AdminUser, allowed: boolean) {
    await apiFetch(`/admin/users/${u.id}/uploads`, { method: "PATCH", body: JSON.stringify({ allowed }) });
    await load();
  }

  async function saveSetting(key: string, value: string) {
    await apiFetch("/admin/settings", { method: "PATCH", body: JSON.stringify({ [key]: value }) });
    await load();
  }

  async function setCreatorFederation(username: string, enabled: boolean) {
    await apiFetch(`/admin/federation/creators/${username}/settings`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    });
    await load();
  }

  async function setInstanceStatus(id: string, status: string) {
    await apiFetch(`/admin/federation/instances/${id}/status`, { method: "POST", body: JSON.stringify({ status }) });
    await load();
  }

  if (loading) return <Loading />;
  if (!user || user.role !== "ADMIN") return <p className="lede">{t("admin.onlyAdmins")}</p>;

  const sections: SettingsSection[] = TABS.map((id) => ({
    id,
    label: t(TAB_LABEL_KEYS[id]),
    icon: TAB_ICONS[id],
    group: t(TAB_GROUP_KEYS[id]),
  }));

  return (
    <SettingsShell
      sections={sections}
      activeId={tab}
      onSelect={(id) => setTab(id as Tab)}
      title={t("admin.title")}
      description={t("admin.lede")}
    >
      {error && <div className="error-banner">{error}</div>}

      {tab === "overview" && (
        <>
          {!stats && <Loading />}
          {stats && (
            <div className="product-grid">
              <StatCard label={t("admin.statUsers")} value={stats.users} />
              <StatCard label={t("admin.statAuthors")} value={stats.authors} />
              <StatCard label={t("admin.statPosts")} value={stats.publishedPosts} />
              <StatCard label={t("admin.statPayments")} value={stats.confirmedPayments} />
              <StatCard label={t("admin.tabReports")} value={stats.openReports} />
              <StatCard label={t("admin.statInvites")} value={stats.unusedInvites} />
            </div>
          )}
        </>
      )}

      {tab === "apiAccess" && <ApiAccessTab />}

      {tab === "invites" && <InviteManager />}
      {tab === "announcements" && <AnnouncementsTab />}
      {tab === "stickers" && <StickersTab />}

      {tab === "reports" && (
        <div className="stack" style={{ gap: 8 }}>
          {reports.length === 0 && <div className="empty-state">{t("admin.empty")}</div>}
          {reports.map((r) => (
            <div key={r.id} className="card report-card">
              <div className="report-card-body">
                <div className="row" style={{ gap: 8 }}>
                  <strong>{t(`report.category.${r.category ?? "other"}` as TranslationKey) || r.category}</strong>
                  <StatusPill prefix="report.status" status={r.status} />
                </div>
                <div className="report-card-target">
                  <span className="badge">{t(`report.target.${r.targetType}` as TranslationKey) || r.targetType}</span>{" "}
                  {r.target ? (
                    <>
                      <a href={r.target.path} target="_blank" rel="noreferrer">
                        {r.target.label || r.target.path}
                      </a>
                      <span className="meta"> · {t("report.by", { username: r.target.author })}</span>
                    </>
                  ) : (
                    <span className="meta">{t("report.gone")}</span>
                  )}
                </div>
                {r.reason && <p className="report-card-reason">{r.reason}</p>}
                <div className="meta">
                  {r.reporterUsername ? `${t("report.from", { username: r.reporterUsername })} · ` : ""}
                  {formatDateTime(r.createdAt, locale)}
                </div>
              </div>
              {(r.status === "OPEN" || r.status === "REVIEWING") && (
                <div className="row" style={{ gap: 8 }}>
                  <button className="secondary" onClick={() => resolveReport(r.id, "RESOLVED")}>
                    {t("admin.resolve")}
                  </button>
                  <button className="secondary" onClick={() => resolveReport(r.id, "DISMISSED")}>
                    {t("admin.dismiss")}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "users" && (
        <DataTable
          rows={users}
          getRowKey={(u) => u.id}
          initialSort={{ key: "created", direction: "desc" }}
          emptyLabel={t("admin.empty")}
          filters={[
            {
              key: "role",
              label: t("admin.filterRole"),
              options: ["USER", "CREATOR", "MODERATOR", "ADMIN"].map((r) => ({ value: r, label: r })),
              matches: (u, value) => u.role === value,
            },
            {
              key: "status",
              label: t("admin.filterStatus"),
              options: [
                { value: "active", label: t("common.active") },
                { value: "suspended", label: t("admin.suspend") },
              ],
              matches: (u, value) => (value === "suspended" ? Boolean(u.suspendedAt) : !u.suspendedAt),
            },
          ]}
          columns={[
            {
              key: "username",
              label: t("admin.tabUsers"),
              value: (u) => u.username,
              render: (u) => (
                <span>
                  <Username username={u.username} focusable />
                  <div className="meta">{u.role}</div>
                </span>
              ),
            },
            {
              key: "email",
              label: t("admin.contact"),
              value: (u) => u.email ?? "",
              render: (u) =>
                u.email ? (
                  <a className="text-link" href={`mailto:${u.email}`}>
                    {u.email}
                  </a>
                ) : (
                  <span className="meta">{t("admin.noEmail")}</span>
                ),
            },
            {
              key: "status",
              label: t("form.status"),
              value: (u) => (u.suspendedAt ? "suspended" : "active"),
              render: (u) =>
                u.suspendedAt ? (
                  <span className="status-pill">{t("admin.suspend")}</span>
                ) : (
                  <span className="meta">{t("common.active")}</span>
                ),
            },
            {
              key: "uploads",
              label: t("admin.fileUploads"),
              value: (u) => (u.role === "ADMIN" || u.canUploadFiles ? "1" : "0"),
              render: (u) =>
                u.role === "ADMIN" ? (
                  <span className="meta">{t("admin.uploadsAlways")}</span>
                ) : (
                  <label className="check-inline">
                    <input
                      type="checkbox"
                      checked={u.canUploadFiles}
                      aria-label={`${t("admin.uploadsAllow")}: @${u.username}`}
                      title={t("admin.uploadsAllow")}
                      onChange={(e) => setUploads(u, e.target.checked)}
                    />
                  </label>
                ),
            },
            {
              key: "created",
              label: t("admin.created"),
              value: (u) => u.createdAt,
              render: (u) => <span className="meta">{formatDate(u.createdAt, locale)}</span>,
            },
            {
              key: "actions",
              label: t("admin.actions"),
              align: "right",
              render: (u) => (
                <button className={u.suspendedAt ? "secondary" : "danger"} onClick={() => toggleSuspend(u)}>
                  {u.suspendedAt ? t("admin.restore") : t("admin.suspend")}
                </button>
              ),
            },
          ]}
        />
      )}

      {tab === "products" && (
        <DataTable
          rows={products}
          getRowKey={(p) => p.id}
          initialSort={{ key: "title", direction: "asc" }}
          emptyLabel={t("admin.empty")}
          filters={[
            {
              key: "status",
              label: t("admin.filterStatus"),
              options: ["DRAFT", "PUBLISHED", "ARCHIVED", "DISABLED"].map((s) => ({ value: s, label: s })),
              matches: (p, value) => p.status === value,
            },
            {
              key: "type",
              label: t("form.status"),
              options: ["POST", "BUNDLE", "STICKER_PACK", "DIGITAL_FILE"].map((s) => ({ value: s, label: s })),
              matches: (p, value) => p.type === value,
            },
          ]}
          columns={[
            {
              key: "title",
              label: t("form.title"),
              value: (p) => p.title,
              render: (p) => (
                <span>
                  {p.title}
                  <div className="meta">{p.type}</div>
                </span>
              ),
            },
            {
              key: "author",
              label: t("admin.author"),
              value: (p) => p.creator.user.username,
              render: (p) => (
                <a className="text-link" href={`/${p.creator.user.username}`}>
                  @{p.creator.user.username}
                </a>
              ),
            },
            {
              key: "status",
              label: t("form.status"),
              value: (p) => p.status,
              render: (p) => <StatusPill prefix="product.status" status={p.status} />,
            },
            {
              key: "actions",
              label: t("admin.actions"),
              align: "right",
              render: (p) => (
                <button
                  className={p.status === "DISABLED" ? "secondary" : "danger"}
                  onClick={() => setProductDisabled(p.id, p.status !== "DISABLED")}
                >
                  {p.status === "DISABLED" ? t("admin.enable") : t("admin.disable")}
                </button>
              ),
            },
          ]}
        />
      )}

      {tab === "payments" && (
        <>
          {payments.length === 0 && <div className="empty-state">{t("admin.empty")}</div>}
          {payments.length > 0 && (
            <SettingsScroller><table className="data-table">
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <span className="badge">{t(`payments.purpose.${p.purpose}` as TranslationKey) || p.purpose}</span>
                      <div className="meta">{formatDateTime(p.createdAt, locale)}</div>
                    </td>
                    <td>
                      <StatusPill prefix="payments.status" status={p.status} />
                    </td>
                    <td style={{ textAlign: "right" }} className="price-tag">
                      {formatMoney(p.amountMinor, p.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></SettingsScroller>
          )}
        </>
      )}

      {tab === "parameters" && <ParametersTab />}

      {tab === "settings" && serverSettings && (
        <div className="stack" style={{ gap: 16 }}>
          {/* Two switches, each the answer to a question an operator is
              asked by their own users: does an API key cost anything, and
              does this server talk to the fediverse at all. */}
          <div className="card stack" style={{ gap: 8 }}>
            <h2 style={{ margin: 0 }}>{t("admin.apiAccessMode")}</h2>
            <span className="meta">{t("admin.apiAccessModeHint")}</span>
            <div className="button-row">
              {["contribution", "free"].map((mode) => (
                <button
                  key={mode}
                  className={serverSettings.apiAccessMode === mode ? "primary" : "secondary"}
                  onClick={() => saveSetting("apiAccessMode", mode)}
                >
                  {t(mode === "free" ? "admin.apiAccessFree" : "admin.apiAccessContribution")}
                </button>
              ))}
            </div>
          </div>

          <div className="card stack" style={{ gap: 8 }}>
            <h2 style={{ margin: 0 }}>{t("admin.registrationMode")}</h2>
            <span className="meta">{t("admin.registrationModeHint")}</span>
            <div className="button-row">
              {["invite", "open"].map((mode) => (
                <button
                  key={mode}
                  className={serverSettings.registrationMode === mode ? "primary" : "secondary"}
                  onClick={() => saveSetting("registrationMode", mode)}
                >
                  {t(mode === "open" ? "admin.registrationOpen" : "admin.registrationInvite")}
                </button>
              ))}
            </div>
          </div>

          <div className="card stack" style={{ gap: 8 }}>
            <h2 style={{ margin: 0 }}>{t("admin.federationMode")}</h2>
            <span className="meta">{t("admin.federationModeHint")}</span>
            <div className="button-row">
              {["true", "false"].map((value) => (
                <button
                  key={value}
                  className={serverSettings.federationEnabled === value ? "primary" : "secondary"}
                  onClick={() => saveSetting("federationEnabled", value)}
                >
                  {t(value === "true" ? "admin.federationOn" : "admin.federationOff")}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "federation" && (
        <div className="stack" style={{ gap: 16 }}>
          {serverSettings?.federationEnabled === "false" && (
            <div className="empty-state">{t("admin.federationOffNotice")}</div>
          )}

          <div className="card stack" style={{ gap: 8 }}>
            <h2 style={{ margin: 0 }}>{t("admin.federatedAuthors")}</h2>
            <span className="meta">{t("admin.federatedAuthorsHint")}</span>
            <SettingsScroller><table className="data-table">
              <tbody>
                {fedCreators.map((c) => (
                  <tr key={c.username}>
                    <td>
                      {c.displayName}
                      <div className="meta">@{c.username}</div>
                    </td>
                    <td>
                      <span className="status-pill">{c.enabled ? t("admin.federationOn") : t("admin.federationOff")}</span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div className="row" style={{ gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        <button className="secondary" onClick={() => setDeliveriesFor(c.username)}>
                          {t("federation.deliveries")}
                        </button>
                        <button className="secondary" onClick={() => setCreatorFederation(c.username, !c.enabled)}>
                          {c.enabled ? t("admin.federationTurnOff") : t("admin.federationTurnOn")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></SettingsScroller>
          </div>
          {deliveriesFor && <DeliveriesDialog username={deliveriesFor} onClose={() => setDeliveriesFor(null)} />}

          <SettingsScroller><table className="data-table">
            <tbody>
              {instances.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.domain}
                    <div className="meta">{i.platform}</div>
                  </td>
                  <td>
                    <StatusPill prefix="federation.instanceStatus" status={i.status} />
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
                      <button className="secondary" onClick={() => setInstanceStatus(i.id, "APPROVED")}>
                        {t("admin.enable")}
                      </button>
                      <button className="danger" onClick={() => setInstanceStatus(i.id, "BLOCKED")}>
                        {t("admin.disable")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></SettingsScroller>
        </div>
      )}

      {tab === "audit" && <AuditTab />}
    </SettingsShell>
  );
}
