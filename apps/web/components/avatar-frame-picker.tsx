"use client";

import { useState } from "react";
import {
  AVATAR_FRAMES,
  CUSTOM_FRAME_ORNAMENTS,
  CUSTOM_FRAME_STYLES,
  customFrameValue,
  parseCustomFrame,
  type CustomFrame,
} from "@platform/shared";
import { apiFetch, ApiError } from "@/lib/api";
import { Avatar } from "./avatar";
import { useLocale } from "./locale-provider";
import { useSession } from "./session-provider";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

const STARTER: CustomFrame = { style: "gradient", from: "1d9bf0", to: "f91880", width: 2, ornament: "none", spin: false };

/**
 * The author's choice of frame: each option is their own picture wearing
 * it, so what is picked is what will be seen. A ready-made frame is saved
 * at once — there is nothing to review that the preview has not already
 * shown. "Your own" opens a small builder (ring style, two colours,
 * thickness, ornament, a slow turn) whose result is saved with a button,
 * so dragging a colour does not save a dozen times.
 */
export function AvatarFramePicker({
  avatarUrl,
  name,
  value,
  onChange,
}: {
  avatarUrl: string | null;
  name: string;
  value: string | null;
  onChange: (frame: string | null) => void;
}) {
  const { t } = useLocale();
  const { refresh } = useSession();
  const [error, setError] = useState<string | null>(null);
  const saved = parseCustomFrame(value);
  const [draft, setDraft] = useState<CustomFrame>(saved ?? STARTER);
  const [building, setBuilding] = useState(saved !== null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function save(next: string | null) {
    const before = value;
    onChange(next);
    setError(null);
    setDone(false);
    setBusy(true);
    try {
      await apiFetch("/creators/me", { method: "PATCH", body: JSON.stringify({ avatarFrame: next }) });
      // The header wears the frame too.
      void refresh();
      return true;
    } catch (err) {
      onChange(before);
      setError(err instanceof ApiError ? err.message : t("creator.frameError"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const set = (patch: Partial<CustomFrame>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setDone(false);
  };
  const draftValue = customFrameValue(draft);
  const options: (string | null)[] = [null, ...AVATAR_FRAMES];

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div>
        <strong id="frame-label">{t("creator.frame")}</strong>
        <p className="meta" style={{ margin: 0 }}>{t("creator.frameHint")}</p>
      </div>
      {error && <span style={{ color: "var(--danger)", fontSize: "0.85rem" }}>{error}</span>}
      <div className="frame-options" role="radiogroup" aria-labelledby="frame-label">
        {options.map((option) => {
          const label = t(`creator.frameName.${option ?? "none"}` as TranslationKey);
          return (
            <button
              key={option ?? "none"}
              type="button"
              role="radio"
              aria-checked={value === option}
              className={`frame-option${value === option ? " selected" : ""}`}
              onClick={() => {
                setBuilding(false);
                void save(option);
              }}
            >
              <Avatar url={avatarUrl} name={name} frame={option} size="lg" decorative />
              <span>{label}</span>
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={saved !== null}
          className={`frame-option${saved !== null ? " selected" : building ? " is-open" : ""}`}
          onClick={() => setBuilding(true)}
        >
          <Avatar url={avatarUrl} name={name} frame={saved ? value : draftValue} size="lg" decorative />
          <span>{t("creator.frameName.custom")}</span>
        </button>
      </div>

      {building && (
        <div className="frame-builder card">
          <div className="frame-builder-preview">
            <Avatar url={avatarUrl} name={name} frame={draftValue} size="lg" decorative />
          </div>
          <div className="stack" style={{ gap: 12, flex: 1, minWidth: 0 }}>
            <Choice label={t("frameBuilder.style")}>
              {CUSTOM_FRAME_STYLES.map((style) => (
                <button key={style} type="button" className={`chip${draft.style === style ? " selected" : ""}`} aria-pressed={draft.style === style} onClick={() => set({ style })}>
                  {t(`frameBuilder.style.${style}` as TranslationKey)}
                </button>
              ))}
            </Choice>
            <div className="row" style={{ gap: 16 }}>
              <label className="frame-colour">
                <input type="color" value={`#${draft.from}`} onChange={(e) => set({ from: e.target.value.slice(1).toLowerCase() })} />
                {t("frameBuilder.colourMain")}
              </label>
              <label className="frame-colour">
                <input type="color" value={`#${draft.to}`} onChange={(e) => set({ to: e.target.value.slice(1).toLowerCase() })} />
                {t("frameBuilder.colourSecond")}
              </label>
            </div>
            <Choice label={t("frameBuilder.width")}>
              {([1, 2, 3] as const).map((width) => (
                <button key={width} type="button" className={`chip${draft.width === width ? " selected" : ""}`} aria-pressed={draft.width === width} onClick={() => set({ width })}>
                  {t(`frameBuilder.width.${width}` as TranslationKey)}
                </button>
              ))}
            </Choice>
            <Choice label={t("frameBuilder.ornament")}>
              {CUSTOM_FRAME_ORNAMENTS.map((ornament) => (
                <button
                  key={ornament}
                  type="button"
                  className={`chip${draft.ornament === ornament ? " selected" : ""}`}
                  aria-pressed={draft.ornament === ornament}
                  onClick={() => set({ ornament })}
                >
                  {t(`frameBuilder.ornament.${ornament}` as TranslationKey)}
                </button>
              ))}
            </Choice>
            <label className="checkbox-row">
              <input type="checkbox" checked={draft.spin} onChange={(e) => set({ spin: e.target.checked })} />
              {t("frameBuilder.spin")}
            </label>
            <div className="row" style={{ gap: 10 }}>
              <button
                type="button"
                className="primary"
                disabled={busy || draftValue === value}
                onClick={async () => setDone(await save(draftValue))}
              >
                {busy ? t("common.saving") : t("frameBuilder.save")}
              </button>
              {done && (
                <span className="meta" role="status">
                  {t("common.saved")}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Choice({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="stack" style={{ gap: 6 }} role="group" aria-label={label}>
      <span className="meta">{label}</span>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {children}
      </div>
    </div>
  );
}
