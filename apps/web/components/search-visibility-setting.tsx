"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { useLocale } from "./locale-provider";

type Switch = "hideFromSearch" | "hideFromFediverseSearch";

interface Server {
  hideFromSearchEngines: boolean;
  federationEnabled: boolean;
}

/**
 * The author's "keep me out of search", as two separate choices, each
 * saved as soon as it is switched: search engines (noindex on the
 * profile, every post and folder) and the fediverse (Mastodon's search
 * and suggestions). The page stays open to anyone with the link either
 * way. A server its administrator keeps out of search engines shows the
 * first already on and fixed; a server that does not federate has no
 * fediverse to hide from.
 */
export function SearchVisibilitySetting() {
  const { t } = useLocale();
  const [values, setValues] = useState<Record<Switch, boolean> | null>(null);
  const [server, setServer] = useState<Server>({ hideFromSearchEngines: false, federationEnabled: true });
  const [busy, setBusy] = useState<Switch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiFetch<{ creatorProfile: { hideFromSearch?: boolean; hideFromFediverseSearch?: boolean }; server?: Server }>("/creators/me")
      .then((res) => {
        setValues({
          hideFromSearch: Boolean(res.creatorProfile.hideFromSearch),
          hideFromFediverseSearch: Boolean(res.creatorProfile.hideFromFediverseSearch),
        });
        if (res.server) setServer(res.server);
      })
      .catch(() => setValues({ hideFromSearch: false, hideFromFediverseSearch: false }));
  }, []);

  async function toggle(which: Switch, next: boolean) {
    if (!values) return;
    const before = values;
    setValues({ ...values, [which]: next });
    setBusy(which);
    setError(null);
    setSaved(false);
    try {
      await apiFetch("/creators/me", { method: "PATCH", body: JSON.stringify({ [which]: next }) });
      setSaved(true);
    } catch (err) {
      setValues(before);
      setError(err instanceof ApiError ? err.message : t("common.genericError"));
    } finally {
      setBusy(null);
    }
  }

  const engines = server.hideFromSearchEngines || values?.hideFromSearch === true;
  return (
    <section className="card stack" aria-labelledby="search-visibility-title">
      <h2 id="search-visibility-title" style={{ margin: 0 }}>
        {t("searchVisibility.title")}
      </h2>
      {error && <div className="error-banner">{error}</div>}

      <div className="search-visibility-option">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={engines}
            disabled={values === null || busy !== null || server.hideFromSearchEngines}
            onChange={(e) => toggle("hideFromSearch", e.target.checked)}
          />
          {t("searchVisibility.hide")}
        </label>
        <p className="meta">{server.hideFromSearchEngines ? t("searchVisibility.serverHidden") : t("searchVisibility.hint")}</p>
      </div>

      <div className="search-visibility-option">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={values?.hideFromFediverseSearch === true}
            disabled={values === null || busy !== null || !server.federationEnabled}
            onChange={(e) => toggle("hideFromFediverseSearch", e.target.checked)}
          />
          {t("searchVisibility.hideFediverse")}
        </label>
        <p className="meta">{server.federationEnabled ? t("searchVisibility.fediverseHint") : t("searchVisibility.fediverseOff")}</p>
      </div>

      {saved && (
        <p className="meta" role="status" style={{ margin: 0 }}>
          {t("common.saved")}
        </p>
      )}
    </section>
  );
}
