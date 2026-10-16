"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, localizedErrorMessage } from "@/lib/api";
import { addPasskey, cancelledByPerson, passkeysSupported } from "@/lib/webauthn";
import { formatDate } from "@/lib/dates";
import { useLocale } from "./locale-provider";
import { FingerprintIcon, TrashIcon } from "./icons";
import { Loading } from "./loading";

interface Passkey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * Security settings: sign-in by fingerprint, face or device PIN. Each
 * device that holds a passkey is listed, can be removed, and a new one is
 * one button and one touch of the sensor away.
 */
export function PasskeySettings() {
  const { t, locale } = useLocale();
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [supported, setSupported] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPasskeys((await apiFetch<{ passkeys: Passkey[] }>("/auth/passkeys")).passkeys);
    } catch (err) {
      setError(localizedErrorMessage(err, t, "passkeys.loadError"));
    }
  }, [t]);

  useEffect(() => {
    setSupported(passkeysSupported());
    load();
  }, [load]);

  async function add() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await addPasskey();
      setNote(t("passkeys.added"));
      await load();
    } catch (err) {
      if (!cancelledByPerson(err)) setError(localizedErrorMessage(err, t, "passkeys.addError"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(passkey: Passkey) {
    if (!window.confirm(t("passkeys.removeConfirm", { name: passkey.name }))) return;
    setError(null);
    try {
      await apiFetch(`/auth/passkeys/${passkey.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(localizedErrorMessage(err, t, "passkeys.removeError"));
    }
  }

  return (
    <section className="card stack passkeys" aria-labelledby="passkeys-title">
      <h2 id="passkeys-title" style={{ margin: 0 }}>
        {t("passkeys.title")}
      </h2>
      <p className="lede" style={{ margin: 0 }}>
        {t("passkeys.lede")}
      </p>
      {error && <div className="error-banner">{error}</div>}
      {note && (
        <p className="meta" role="status" style={{ margin: 0 }}>
          {note}
        </p>
      )}
      {passkeys === null && !error && <Loading />}
      {passkeys && passkeys.length > 0 && (
        <ul className="passkey-list">
          {passkeys.map((passkey) => (
            <li key={passkey.id}>
              <FingerprintIcon size={20} />
              <span className="passkey-name">
                <strong>{passkey.name}</strong>
                <span className="meta">
                  {t("passkeys.addedOn", { date: formatDate(passkey.createdAt, locale) })}
                  {passkey.lastUsedAt && <> · {t("passkeys.lastUsed", { date: formatDate(passkey.lastUsedAt, locale) })}</>}
                </span>
              </span>
              <button
                type="button"
                className="action-item is-icon is-danger"
                aria-label={`${t("passkeys.remove")}: ${passkey.name}`}
                title={t("passkeys.remove")}
                onClick={() => remove(passkey)}
              >
                <TrashIcon size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {supported ? (
        <button type="button" className="primary" onClick={add} disabled={busy} style={{ alignSelf: "flex-start" }}>
          <FingerprintIcon size={16} />
          {busy ? t("passkeys.waiting") : t("passkeys.add")}
        </button>
      ) : (
        <p className="meta" style={{ margin: 0 }}>
          {t("passkeys.unsupported")}
        </p>
      )}
    </section>
  );
}
