"use client";

import { useEffect, useMemo, useState } from "react";
import { COUNTRY_CODES } from "@platform/shared";
import { apiFetch, localizedErrorMessage } from "@/lib/api";
import { useLocale } from "./locale-provider";
import { TrashIcon } from "./icons";
import { countryName } from "./profile-about";

interface Link {
  label: string;
  url: string;
}

const MAX_LINKS = 10;

/**
 * The profile's description and the author's links — to a site, a shop,
 * other accounts. Saved together; the API tells the author's fediverse
 * followers the profile changed, so the description and the links (as
 * Mastodon-style profile fields) update there too.
 */
export function ProfileAboutSetting() {
  const { t, locale } = useLocale();
  const [bio, setBio] = useState("");
  const [links, setLinks] = useState<Link[]>([]);
  const [birthDate, setBirthDate] = useState("");
  const [showBirthYear, setShowBirthYear] = useState(true);
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [spotify, setSpotify] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<{
      creatorProfile: {
        bio: string | null;
        links: Link[] | null;
        birthDate: string | null;
        showBirthYear: boolean;
        city: string | null;
        country: string | null;
        spotifyUrl: string | null;
      };
    }>("/creators/me")
      .then((res) => {
        const profile = res.creatorProfile;
        setBio(profile.bio ?? "");
        setLinks(Array.isArray(profile.links) ? profile.links : []);
        // A DATE column arrives as midnight UTC; the day is its first ten characters.
        setBirthDate(profile.birthDate ? profile.birthDate.slice(0, 10) : "");
        setShowBirthYear(profile.showBirthYear ?? true);
        setCity(profile.city ?? "");
        setCountry(profile.country ?? "");
        setSpotify(profile.spotifyUrl ?? "");
      })
      .catch(() => {});
  }, []);

  // Every country, named and sorted in the reader's language.
  const countries = useMemo(
    () =>
      COUNTRY_CODES.map((code) => ({ code, name: countryName(code, locale) })).sort((a, b) => a.name.localeCompare(b.name, locale)),
    [locale],
  );

  function update(index: number, patch: Partial<Link>) {
    setSaved(false);
    setLinks((prev) => prev.map((link, i) => (i === index ? { ...link, ...patch } : link)));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      // A row left entirely empty is dropped rather than refused.
      const cleaned = links
        .map((link) => ({ label: link.label.trim(), url: link.url.trim() }))
        .filter((link) => link.label || link.url);
      await apiFetch("/creators/me", {
        method: "PATCH",
        body: JSON.stringify({
          bio: bio.trim(),
          links: cleaned,
          birthDate,
          showBirthYear,
          city: city.trim(),
          country,
          spotifyUrl: spotify.trim(),
        }),
      });
      setLinks(cleaned);
      setSaved(true);
    } catch (err) {
      setError(localizedErrorMessage(err, t, "common.genericError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={save}>
      <h2 style={{ margin: 0 }}>{t("profile.aboutTitle")}</h2>
      <p className="lede" style={{ margin: 0 }}>{t("profile.aboutHint")}</p>
      {error && <div className="error-banner">{error}</div>}

      <div className="form-field">
        <label htmlFor="profile-bio">{t("profile.bioLabel")}</label>
        <textarea
          id="profile-bio"
          rows={4}
          maxLength={2000}
          value={bio}
          onChange={(e) => {
            setSaved(false);
            setBio(e.target.value);
          }}
        />
        <span className="meta">{t("profile.bioHint")}</span>
      </div>

      <fieldset className="form-field profile-links-field">
        <legend>{t("profile.links")}</legend>
        {links.map((link, index) => (
          <div key={index} className="profile-link-row">
            <input
              aria-label={`${t("profile.linkLabel")} ${index + 1}`}
              placeholder={t("profile.linkLabel")}
              maxLength={40}
              value={link.label}
              onChange={(e) => update(index, { label: e.target.value })}
              required={link.url.trim() !== ""}
            />
            <input
              type="url"
              aria-label={`${t("profile.linkUrl")} ${index + 1}`}
              placeholder="https://"
              value={link.url}
              onChange={(e) => update(index, { url: e.target.value })}
              required={link.label.trim() !== ""}
            />
            <button
              type="button"
              className="secondary icon-button"
              aria-label={t("profile.removeLink")}
              title={t("profile.removeLink")}
              onClick={() => {
                setSaved(false);
                setLinks((prev) => prev.filter((_, i) => i !== index));
              }}
            >
              <TrashIcon size={16} />
            </button>
          </div>
        ))}
        {links.length < MAX_LINKS ? (
          <button
            type="button"
            className="secondary"
            style={{ width: "fit-content" }}
            onClick={() => setLinks((prev) => [...prev, { label: "", url: "" }])}
          >
            {t("profile.addLink")}
          </button>
        ) : (
          <span className="meta">{t("profile.linksLimit")}</span>
        )}
      </fieldset>

      <fieldset className="form-field profile-personal">
        <legend>{t("about.personal")}</legend>
        <p className="meta" style={{ margin: 0 }}>
          {t("about.personalHint")}
        </p>
        <div className="profile-personal-row">
          <div className="form-field">
            <label htmlFor="profile-birth">{t("about.birthDate")}</label>
            <input
              id="profile-birth"
              type="date"
              min="1900-01-01"
              max={new Date().toISOString().slice(0, 10)}
              value={birthDate}
              onChange={(e) => {
                setSaved(false);
                setBirthDate(e.target.value);
              }}
            />
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={showBirthYear}
              onChange={(e) => {
                setSaved(false);
                setShowBirthYear(e.target.checked);
              }}
            />
            {t("about.showYear")}
          </label>
        </div>
        <div className="profile-personal-row">
          <div className="form-field">
            <label htmlFor="profile-city">{t("about.city")}</label>
            <input
              id="profile-city"
              maxLength={80}
              value={city}
              onChange={(e) => {
                setSaved(false);
                setCity(e.target.value);
              }}
            />
          </div>
          <div className="form-field">
            <label htmlFor="profile-country">{t("about.country")}</label>
            <select
              id="profile-country"
              value={country}
              onChange={(e) => {
                setSaved(false);
                setCountry(e.target.value);
              }}
            >
              <option value="">{t("about.noCountry")}</option>
              {countries.map(({ code, name }) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </fieldset>

      <div className="form-field">
        <label htmlFor="profile-spotify">{t("about.spotify")}</label>
        <input
          id="profile-spotify"
          type="url"
          placeholder="https://open.spotify.com/playlist/…"
          value={spotify}
          onChange={(e) => {
            setSaved(false);
            setSpotify(e.target.value);
          }}
        />
        <span className="meta">{t("about.spotifyHint")}</span>
      </div>

      <div className="row" style={{ gap: 10 }}>
        <button className="primary" type="submit" disabled={busy} style={{ width: "fit-content" }}>
          {busy ? t("common.saving") : t("common.save")}
        </button>
        {saved && (
          <span className="meta" role="status">
            {t("profile.saved")}
          </span>
        )}
      </div>
    </form>
  );
}
