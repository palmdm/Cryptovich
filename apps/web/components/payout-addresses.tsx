"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { useLocale } from "./locale-provider";
import { QrCode } from "./qr-code";
import { Loading } from "@/components/loading";

export interface PayoutWallet {
  id: string;
  network: "BITCOIN" | "ETHEREUM" | "POLYGON" | "TRON" | "MONERO";
  address: string;
  label: string | null;
}

const NETWORK_LABELS: Record<PayoutWallet["network"], string> = {
  BITCOIN: "Bitcoin",
  ETHEREUM: "Ethereum",
  POLYGON: "Polygon",
  TRON: "TRON",
  MONERO: "Monero",
};

/**
 * What a supporter is shown at checkout: the author's own addresses, one
 * expandable QR each. The platform never watches these — the author
 * confirms receipt — so nothing here implies an automatic unlock.
 */
export function PayoutAddressList({ wallets }: { wallets: PayoutWallet[] }) {
  const [shown, setShown] = useState<string | null>(null);
  const { t } = useLocale();

  if (wallets.length === 0) return null;

  return (
    <div className="stack" style={{ gap: 8 }}>
      <span className="meta">{t("wallets.payTo")}</span>
      {wallets.map((w) => (
        <div key={w.id} className="card stack" style={{ padding: 12, gap: 8 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>
              <span className="badge">{NETWORK_LABELS[w.network]}</span>
              {w.label && <span className="meta" style={{ marginLeft: 8 }}>{w.label}</span>}
            </span>
            <button className="link-button" onClick={() => setShown(shown === w.id ? null : w.id)}>
              {shown === w.id ? t("wallets.hideQr") : t("wallets.showQr")}
            </button>
          </div>
          <code style={{ wordBreak: "break-all" }}>{w.address}</code>
          {shown === w.id && <QrCode value={w.address} size={160} />}
        </div>
      ))}
    </div>
  );
}

/** Author-side management of the same list. */
export function PayoutAddressManager() {
  const { t } = useLocale();
  const [wallets, setWallets] = useState<PayoutWallet[] | null>(null);
  const [network, setNetwork] = useState<PayoutWallet["network"]>("ETHEREUM");
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setWallets((await apiFetch<{ wallets: PayoutWallet[] }>("/wallets/mine")).wallets);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("wallets.loadError"));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/wallets", {
        method: "POST",
        body: JSON.stringify({ network, address: address.trim(), label: label.trim() || undefined }),
      });
      setAddress("");
      setLabel("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("wallets.addError"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await apiFetch(`/wallets/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("wallets.removeError"));
    }
  }

  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>{t("wallets.title")}</h2>
      <p className="lede" style={{ margin: 0 }}>{t("wallets.lede")}</p>
      {error && <div className="error-banner">{error}</div>}

      <form className="stack" style={{ gap: 8 }} onSubmit={add}>
        <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
          <div className="form-field">
            <label htmlFor="network">{t("wallets.network")}</label>
            <select id="network" value={network} onChange={(e) => setNetwork(e.target.value as PayoutWallet["network"])}>
              {(Object.keys(NETWORK_LABELS) as PayoutWallet["network"][]).map((n) => (
                <option key={n} value={n}>{NETWORK_LABELS[n]}</option>
              ))}
            </select>
          </div>
          <div className="form-field" style={{ flex: 2, minWidth: 220 }}>
            <label htmlFor="address">{t("wallets.address")}</label>
            <input id="address" required value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="form-field" style={{ flex: 1, minWidth: 120 }}>
            <label htmlFor="label">{t("wallets.label")}</label>
            <input id="label" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
        </div>
        <button className="primary" type="submit" disabled={busy} style={{ alignSelf: "flex-start" }}>
          {busy ? t("common.saving") : t("wallets.add")}
        </button>
      </form>

      {wallets === null && <Loading />}
      {wallets?.length === 0 && <div className="empty-state">{t("wallets.empty")}</div>}
      {wallets && wallets.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {wallets.map((w) => (
            <div key={w.id} className="row" style={{ justifyContent: "space-between", gap: 8 }}>
              <span style={{ minWidth: 0 }}>
                <span className="badge">{NETWORK_LABELS[w.network]}</span>
                <code style={{ marginLeft: 8, wordBreak: "break-all" }}>{w.address}</code>
                {w.label && <span className="meta" style={{ marginLeft: 8 }}>{w.label}</span>}
              </span>
              <button className="danger" onClick={() => remove(w.id)}>{t("common.delete")}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
