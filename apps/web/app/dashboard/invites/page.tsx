"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, localizedErrorMessage } from "@/lib/api";
import { useSession } from "@/components/session-provider";
import { useLocale } from "@/components/locale-provider";
import { CopyButton } from "@/components/copy-button";
import { AuthRequired } from "@/components/auth-prompt";
import { Loading } from "@/components/loading";

interface MemberInvite {
  id: string;
  code: string;
  note: string | null;
  maxUses: number | null;
  usedCount: number;
  usedBy: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

interface Limits {
  maxActive: number;
  maxUses: number;
  maxDays: number;
  defaultDays: number;
}

/** Live means it can still bring someone in; the same test the server applies. */
function isActive(invite: MemberInvite): boolean {
  if (invite.revokedAt) return false;
  if (invite.expiresAt && new Date(invite.expiresAt) <= new Date()) return false;
  return invite.maxUses === null || invite.usedCount < invite.maxUses;
}

export default function InvitesSettingsPage() {
  const { user, loading } = useSession();
  const { t, locale } = useLocale();
  const [invites, setInvites] = useState<MemberInvite[] | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [note, setNote] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ invites: MemberInvite[]; limits: Limits }>("/invites");
      setInvites(res.invites);
      setLimits(res.limits);
      setExpiresInDays((v) => v || String(res.limits.defaultDays));
    } catch (err) {
      setError(localizedErrorMessage(err, t, "invites.loadError"));
    }
  }, [t]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ invite: { code: string } }>("/invites", {
        method: "POST",
        body: JSON.stringify({
          note: note.trim() || undefined,
          maxUses: Number(maxUses) || 1,
          expiresInDays: Number(expiresInDays) || undefined,
        }),
      });
      setCreated(res.invite.code);
      setNote("");
      await load();
    } catch (err) {
      setError(localizedErrorMessage(err, t, "invites.loadError"));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setError(null);
    try {
      await apiFetch(`/invites/${id}/revoke`, { method: "POST" });
      await load();
    } catch (err) {
      setError(localizedErrorMessage(err, t, "invites.loadError"));
    }
  }

  function state(invite: MemberInvite): string {
    if (invite.revokedAt) return t("admin.inviteRevoked");
    if (invite.expiresAt && new Date(invite.expiresAt) <= new Date()) return t("admin.inviteExpired");
    if (invite.maxUses !== null && invite.usedCount >= invite.maxUses) return t("admin.inviteExhausted");
    return t("admin.inviteActive");
  }

  if (loading) return <Loading />;
  if (!user) return <AuthRequired />;

  const activeCount = invites ? invites.filter(isActive).length : 0;
  const atLimit = limits !== null && activeCount >= limits.maxActive;
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <h1>{t("invites.title")}</h1>
        <p className="lede">{t("invites.lede")}</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <form className="card stack" style={{ gap: 12 }} onSubmit={create}>
        <h2 style={{ margin: 0 }}>{t("invites.create")}</h2>
        <div className="row" style={{ gap: 12, alignItems: "flex-end" }}>
          <div className="form-field" style={{ flex: 2, minWidth: 180 }}>
            <label htmlFor="invite-note">{t("invites.note")}</label>
            <input id="invite-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="form-field" style={{ flex: 1, minWidth: 110 }}>
            <label htmlFor="invite-uses">{t("invites.maxUses")}</label>
            <input
              id="invite-uses"
              type="number"
              min={1}
              max={limits?.maxUses ?? 10}
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
            />
          </div>
          <div className="form-field" style={{ flex: 1, minWidth: 110 }}>
            <label htmlFor="invite-expiry">{t("invites.expiry")}</label>
            <input
              id="invite-expiry"
              type="number"
              min={1}
              max={limits?.maxDays ?? 90}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
            />
          </div>
        </div>
        <span className="meta">{t("invites.noteHint")}</span>
        <div className="row" style={{ gap: 12, alignItems: "center" }}>
          <button className="primary" type="submit" disabled={busy || atLimit}>
            {busy ? t("common.saving") : t("invites.create")}
          </button>
          {limits && (
            <span className="meta">
              {t("invites.activeOf")}: {activeCount} / {limits.maxActive}
            </span>
          )}
        </div>

        {created && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="meta">{t("invites.created")}</span>
            <div className="invite-code-row">
              <code className="invite-code is-large">{created}</code>
              <CopyButton value={created} label={t("admin.inviteCopy")} />
            </div>
          </div>
        )}
      </form>

      {invites === null && !error && <Loading />}
      {invites?.length === 0 && <div className="empty-state">{t("invites.empty")}</div>}
      {invites && invites.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {invites.map((i) => (
            <div key={i.id} className="card stack" style={{ gap: 8 }}>
              <div className="invite-code-row">
                <code className="invite-code">{i.code}</code>
                {isActive(i) && <CopyButton value={i.code} label={t("admin.inviteCopy")} />}
                <span className="status-pill">{state(i)}</span>
              </div>
              {i.note && <div className="meta">{i.note}</div>}
              <div className="meta">
                {i.usedCount}
                {i.maxUses === null ? " / ∞" : ` / ${i.maxUses}`} {t("admin.inviteUsed")}
                {i.expiresAt && <> · {dateFormat.format(new Date(i.expiresAt))}</>}
              </div>
              {i.usedBy.length > 0 && (
                <div className="meta">
                  {t("invites.usedBy")}{" "}
                  {i.usedBy.map((name, idx) => (
                    <span key={name}>
                      {idx > 0 && ", "}
                      <Link href={`/${name}`}>@{name}</Link>
                    </span>
                  ))}
                </div>
              )}
              {isActive(i) && (
                <div className="button-row">
                  <button type="button" className="danger" onClick={() => revoke(i.id)}>
                    {t("admin.inviteRevoke")}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
