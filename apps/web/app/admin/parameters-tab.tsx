"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  isServerParameterKey,
  normaliseParameter,
  PARAMETER_GROUPS,
  PARAMETERS_EXPORT_FORMAT,
  LEGACY_PARAMETERS_EXPORT_FORMATS,
  SERVER_PARAMETERS,
  type ParameterProblem,
  type ParameterSource,
  type ServerOnlyReason,
  type ServerParameterKey,
} from "@platform/shared";
import { apiFetch, ApiError, API_URL, localizedErrorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";
import { useLocale } from "@/components/locale-provider";
import { Loading } from "@/components/loading";
import { TwoFactorEnrollment } from "@/components/two-factor-enrollment";
import { SettingsGroup, SettingsRow, SettingsScroller } from "@/components/settings-shell";
import { DownloadIcon, FingerprintIcon, UploadIcon } from "@/components/icons";
import { cancelledByPerson, confirmWithPasskey, passkeysSupported } from "@/lib/webauthn";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

interface Parameter {
  key: ServerParameterKey;
  value: string | null;
  set: boolean;
  source: ParameterSource;
}

interface ServerOnly {
  env: string;
  reason: ServerOnlyReason;
  secret: boolean;
  set: boolean;
  value: string | null;
}

type Page =
  | { kind: "loading" }
  | { kind: "setup" }
  | { kind: "locked" }
  | { kind: "open"; parameters: Parameter[]; serverOnly: ServerOnly[]; unlockedUntil: string };

interface ImportPreview {
  changes: { key: ServerParameterKey; from: string; to: string }[];
  values: Record<string, string>;
  unknown: string[];
  invalid: string[];
}

const OPTION_LABELS: Record<string, TranslationKey> = {
  "registrationMode.invite": "admin.registrationInvite",
  "registrationMode.open": "admin.registrationOpen",
  "apiAccessMode.contribution": "admin.apiAccessContribution",
  "apiAccessMode.free": "admin.apiAccessFree",
  "federationMode.open": "parameters.option.federationMode.open",
  "federationMode.allowlist": "parameters.option.federationMode.allowlist",
};

const isSecret = (key: ServerParameterKey) => SERVER_PARAMETERS[key].kind === "secret";

/**
 * Admin → "Редактирование параметров": every setting the operator can
 * change without the server, in one table, with export and import. It
 * opens with a fresh second factor — the administrator's passkey
 * (fingerprint) first when they have one and this browser can use it,
 * else a code from the authenticator app; the server holds it open ten
 * minutes for this browser. An administrator with neither sets up the app
 * here first. Values are checked here by the same rules the server uses
 * (`normaliseParameter`), so a mistake shows before anything is sent.
 */
export function ParametersTab() {
  const { t, locale } = useLocale();
  const [page, setPage] = useState<Page>({ kind: "loading" });
  const [draft, setDraft] = useState<Partial<Record<ServerParameterKey, string | null>>>({});
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [withSecrets, setWithSecrets] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  // Which ways in this administrator has, asked once the page is locked.
  const [methods, setMethods] = useState<{ passkey: boolean; code: boolean } | null>(null);

  /** Locked and set-up answers are pages of their own, not errors. */
  const handle = useCallback(
    (err: unknown, fallback: TranslationKey) => {
      if (err instanceof ApiError && err.code === "PARAMETERS_LOCKED") setPage({ kind: "locked" });
      else if (err instanceof ApiError && err.code === "TWO_FACTOR_SETUP_NEEDED") setPage({ kind: "setup" });
      else setError(localizedErrorMessage(err, t, fallback));
    },
    [t],
  );

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ parameters: Parameter[]; serverOnly: ServerOnly[]; unlockedUntil: string }>("/admin/parameters");
      setPage({ kind: "open", ...res });
    } catch (err) {
      handle(err, "parameters.loadError");
    }
  }, [handle]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (page.kind !== "locked" || methods) return;
    apiFetch<{ passkey: boolean; code: boolean }>("/admin/parameters/unlock")
      .then((m) => setMethods({ passkey: m.passkey && passkeysSupported(), code: m.code }))
      .catch(() => setMethods({ passkey: false, code: true }));
  }, [page.kind, methods]);

  const current = useMemo(
    () => (page.kind === "open" ? Object.fromEntries(page.parameters.map((p) => [p.key, p])) : {}) as Record<ServerParameterKey, Parameter>,
    [page],
  );

  function problemText(key: ServerParameterKey, problem: ParameterProblem): string {
    const def = SERVER_PARAMETERS[key] as { min?: number; max?: number };
    return t(`parameters.problem.${problem}` as TranslationKey, { min: def.min ?? 0, max: def.max ?? 0 });
  }

  // What the draft would save, and which of its values do not fit.
  const problems = useMemo(() => {
    const out: Partial<Record<ServerParameterKey, ParameterProblem>> = {};
    for (const [key, value] of Object.entries(draft) as [ServerParameterKey, string | null][]) {
      if (value === null) continue;
      const checked = normaliseParameter(key, value);
      if (!checked.ok) out[key] = checked.problem;
    }
    return out;
  }, [draft]);
  const pending = Object.keys(draft).length;

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/admin/parameters/unlock", { method: "POST", body: JSON.stringify({ code: code.trim() }) });
      setCode("");
      await load();
    } catch (err) {
      handle(err, "parameters.loadError");
    } finally {
      setBusy(false);
    }
  }

  async function unlockWithPasskey() {
    setBusy(true);
    setError(null);
    try {
      const passkey = await confirmWithPasskey("/admin/parameters/unlock/passkey-options");
      await apiFetch("/admin/parameters/unlock", { method: "POST", body: JSON.stringify({ passkey }) });
      await load();
    } catch (err) {
      if (!cancelledByPerson(err)) handle(err, "parameters.passkeyError");
    } finally {
      setBusy(false);
    }
  }

  async function lock() {
    await apiFetch("/admin/parameters/lock", { method: "POST" }).catch(() => {});
    setPage({ kind: "locked" });
  }

  async function save(values: Record<string, string | null>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<{ parameters: Parameter[] }>("/admin/parameters", { method: "PUT", body: JSON.stringify({ values }) });
      setPage((p) => (p.kind === "open" ? { ...p, parameters: res.parameters } : p));
      setDraft({});
      setPreview(null);
      setNotice(t("parameters.saved"));
    } catch (err) {
      handle(err, "parameters.loadError");
    } finally {
      setBusy(false);
    }
  }

  function edit(key: ServerParameterKey, value: string | null) {
    setNotice(null);
    setDraft((d) => {
      const next = { ...d };
      const now = current[key];
      // Back to what is in force: nothing to save for this one.
      if (value !== null && !isSecret(key) && now && value === now.value) delete next[key];
      else if (isSecret(key) && value === "") delete next[key];
      else next[key] = value;
      return next;
    });
  }

  async function readImport(file: File) {
    setError(null);
    setNotice(null);
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      setError(t("parameters.importBad"));
      return;
    }
    const parsed = data as { format?: unknown; parameters?: unknown };
    if ((parsed?.format !== PARAMETERS_EXPORT_FORMAT && !LEGACY_PARAMETERS_EXPORT_FORMATS.includes(String(parsed?.format))) || !parsed.parameters || typeof parsed.parameters !== "object") {
      setError(t("parameters.importBad"));
      return;
    }
    const result: ImportPreview = { changes: [], values: {}, unknown: [], invalid: [] };
    for (const [key, raw] of Object.entries(parsed.parameters as Record<string, unknown>)) {
      if (!isServerParameterKey(key)) {
        result.unknown.push(key);
        continue;
      }
      const checked = normaliseParameter(key, raw);
      if (!checked.ok) {
        result.invalid.push(key);
        continue;
      }
      const now = current[key];
      // A secret cannot be compared — this page never sees it — so one in
      // the file is a change whenever it says anything.
      if (isSecret(key) ? checked.value !== "" : now?.value !== checked.value) {
        result.values[key] = checked.value;
        result.changes.push({ key, from: isSecret(key) ? (now?.set ? "••••" : "—") : (now?.value ?? ""), to: isSecret(key) ? t("parameters.importSecretNew") : checked.value });
      }
    }
    setPreview(result);
  }

  if (page.kind === "loading") return <Loading />;

  // A passkey this browser cannot use and no app: setting the app up is the way in.
  if (page.kind === "setup" || (page.kind === "locked" && methods && !methods.passkey && !methods.code)) {
    return (
      <div className="card stack" style={{ gap: 12 }}>
        <h2 style={{ margin: 0 }}>{t("parameters.setupTitle")}</h2>
        <p className="lede" style={{ margin: 0 }}>
          {t("parameters.setupLede")}
        </p>
        <TwoFactorEnrollment autoStart onEnabled={() => setPage({ kind: "locked" })} />
      </div>
    );
  }

  if (page.kind === "locked") {
    if (!methods) return <Loading />;
    // The passkey goes first when there is one: one touch, nothing to type.
    return (
      <div className="card stack parameters-lock" style={{ gap: 12 }}>
        <h2 style={{ margin: 0 }}>{t(methods.passkey ? "parameters.lockedTitlePasskey" : "parameters.lockedTitle")}</h2>
        <p className="lede" style={{ margin: 0 }}>
          {t(methods.passkey ? "parameters.lockedLedePasskey" : "parameters.lockedLede")}
        </p>
        {error && <div className="error-banner">{error}</div>}
        {methods.passkey && (
          <button type="button" className="primary passkey-sign-in" onClick={unlockWithPasskey} disabled={busy} autoFocus>
            <FingerprintIcon size={18} />
            {busy ? t("passkeys.waiting") : t("parameters.unlockPasskey")}
          </button>
        )}
        {methods.code && (
          <form className="stack" style={{ gap: 12 }} onSubmit={unlock}>
            {methods.passkey && <p className="parameters-lock-or meta">{t("parameters.orCode")}</p>}
            <div className="form-field">
              <label htmlFor="parameters-code">{t("parameters.codeLabel")}</label>
              <input
                id="parameters-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus={!methods.passkey}
                required
                pattern="\d{6}"
              />
            </div>
            <button type="submit" className={methods.passkey ? "secondary" : "primary"} disabled={busy || code.length !== 6}>
              {t("parameters.unlock")}
            </button>
          </form>
        )}
      </div>
    );
  }

  function control(p: Parameter) {
    const def = SERVER_PARAMETERS[p.key] as { kind: string; values?: readonly string[]; min?: number; max?: number };
    const value = p.key in draft ? draft[p.key] : p.value;
    const id = `parameter-${p.key}`;
    const invalid = problems[p.key];
    const common = { id, "aria-invalid": invalid ? true : undefined, disabled: busy };
    switch (def.kind) {
      case "boolean":
        return (
          <select {...common} value={value ?? ""} onChange={(e) => edit(p.key, e.target.value)}>
            <option value="true">{t("parameters.yes")}</option>
            <option value="false">{t("parameters.no")}</option>
          </select>
        );
      case "choice":
        return (
          <select {...common} value={value ?? ""} onChange={(e) => edit(p.key, e.target.value)}>
            {def.values!.map((option) => (
              <option key={option} value={option}>
                {t(OPTION_LABELS[`${p.key}.${option}`] ?? ("parameters.yes" as TranslationKey))}
              </option>
            ))}
          </select>
        );
      case "integer":
        return (
          <span className="parameters-number">
            <input {...common} type="number" min={def.min} max={def.max} step={1} value={value ?? ""} onChange={(e) => edit(p.key, e.target.value)} />
            {(p.key === "maxUploadBytes" || p.key === "adminMaxUploadBytes") && value && /^\d+$/.test(value) && (
              <span className="meta">{t("parameters.megabytes", { mb: (Number(value) / (1024 * 1024)).toFixed(1).replace(/\.0$/, "") })}</span>
            )}
          </span>
        );
      case "secret":
        return (
          <input
            {...common}
            type="password"
            autoComplete="new-password"
            placeholder={`${p.set ? t("parameters.secretSet") : t("parameters.secretUnset")} — ${t("parameters.secretPlaceholder")}`}
            value={typeof draft[p.key] === "string" ? (draft[p.key] as string) : ""}
            onChange={(e) => edit(p.key, e.target.value)}
          />
        );
      default:
        return <input {...common} value={value ?? ""} onChange={(e) => edit(p.key, e.target.value)} spellCheck={false} />;
    }
  }

  const exportHref = `${API_URL}/admin/parameters/export${withSecrets ? "?secrets=true" : ""}`;

  return (
    <div className="stack parameters" style={{ gap: 16 }}>
      <p className="lede" style={{ margin: 0 }}>
        {t("parameters.lede")}
      </p>

      <div className="parameters-bar">
        <span className="meta">{t("parameters.openUntil", { time: formatDateTime(page.unlockedUntil, locale) })}</span>
        <button type="button" className="secondary" onClick={lock}>
          {t("parameters.lock")}
        </button>
        <span className="parameters-bar-gap" />
        <a className="btn-secondary" href={exportHref} download>
          <DownloadIcon size={16} />
          {t("parameters.export")}
        </a>
        <label className="parameters-check">
          <input type="checkbox" checked={withSecrets} onChange={(e) => setWithSecrets(e.target.checked)} />
          {t("parameters.exportSecrets")}
        </label>
        <label className="btn-secondary parameters-import">
          <UploadIcon size={16} />
          {t("parameters.import")}
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void readImport(file);
            }}
          />
        </label>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {notice && (
        <p className="meta" role="status" style={{ margin: 0 }}>
          {notice}
        </p>
      )}

      {preview && (
        <div className="card stack" style={{ gap: 10 }}>
          <h2 style={{ margin: 0 }}>{t("parameters.importTitle")}</h2>
          {preview.changes.length === 0 ? (
            <p className="meta" style={{ margin: 0 }}>
              {t("parameters.importNothing")}
            </p>
          ) : (
            <SettingsScroller>
              <table className="parameters-diff">
                <thead>
                  <tr>
                    <th>{t("parameters.name")}</th>
                    <th>{t("parameters.current")}</th>
                    <th>{t("parameters.new")}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.changes.map((change) => (
                    <tr key={change.key}>
                      <td>{t(`parameters.label.${change.key}` as TranslationKey)}</td>
                      <td>{change.from || "—"}</td>
                      <td>{change.to || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SettingsScroller>
          )}
          {preview.unknown.length > 0 && <p className="meta">{t("parameters.importUnknown", { keys: preview.unknown.join(", ") })}</p>}
          {preview.invalid.length > 0 && (
            <div className="error-banner">
              {t("parameters.importInvalid", { keys: preview.invalid.map((k) => (isServerParameterKey(k) ? t(`parameters.label.${k}` as TranslationKey) : k)).join(", ") })}
            </div>
          )}
          <div className="button-row">
            <button
              type="button"
              className="primary"
              disabled={busy || preview.changes.length === 0 || preview.invalid.length > 0}
              onClick={() => save(preview.values)}
            >
              {t("parameters.importApply")}
            </button>
            <button type="button" className="secondary" onClick={() => setPreview(null)}>
              {t("parameters.importCancel")}
            </button>
          </div>
        </div>
      )}

      {PARAMETER_GROUPS.map((group) => {
        const rows = page.parameters.filter((p) => SERVER_PARAMETERS[p.key].group === group);
        if (rows.length === 0) return null;
        return (
          <SettingsGroup key={group} title={t(`parameters.group.${group}` as TranslationKey)}>
            {rows.map((p) => {
              const env = (SERVER_PARAMETERS[p.key] as { env?: string }).env;
              const changed = p.key in draft;
              return (
                <SettingsRow key={p.key} label={t(`parameters.label.${p.key}` as TranslationKey)} hint={t(`parameters.hint.${p.key}` as TranslationKey)}>
                  <div className="parameters-control">
                    {control(p)}
                    <span className="parameters-meta">
                      <span className={`parameters-source is-${changed ? "draft" : p.source}`}>
                        {t(`parameters.source.${p.source}` as TranslationKey)}
                      </span>
                      {env && <code>{env}</code>}
                      {p.source === "stored" && (
                        <button type="button" className="link-button" title={t("parameters.resetHint")} onClick={() => edit(p.key, null)} disabled={busy}>
                          {t("parameters.reset")}
                        </button>
                      )}
                      {/* An empty box leaves a secret as it is; this saves it empty —
                          no mail server, say, even if .env names one. */}
                      {isSecret(p.key) && p.set && !(p.key in draft) && (
                        <button type="button" className="link-button" onClick={() => setDraft((d) => ({ ...d, [p.key]: "" }))} disabled={busy}>
                          {t("parameters.clear")}
                        </button>
                      )}
                    </span>
                    {problems[p.key] && <span className="field-error">{problemText(p.key, problems[p.key]!)}</span>}
                  </div>
                </SettingsRow>
              );
            })}
          </SettingsGroup>
        );
      })}

      {pending > 0 && (
        <div className="parameters-save">
          <button
            type="button"
            className="primary"
            disabled={busy || Object.keys(problems).length > 0}
            onClick={() => save(draft as Record<string, string | null>)}
          >
            {t("parameters.save", { count: pending })}
          </button>
          <button type="button" className="secondary" onClick={() => setDraft({})} disabled={busy}>
            {t("parameters.importCancel")}
          </button>
        </div>
      )}

      <SettingsGroup title={t("parameters.serverOnlyTitle")} description={t("parameters.serverOnlyLede")}>
        {page.serverOnly.map((row) => (
          <SettingsRow key={row.env} label={row.env} hint={t(`parameters.reason.${row.reason}` as TranslationKey)}>
            <span className="parameters-readonly">
              {row.secret ? (row.set ? t("parameters.secretSet") : t("parameters.secretUnset")) : row.value || "—"}
            </span>
          </SettingsRow>
        ))}
      </SettingsGroup>
    </div>
  );
}
