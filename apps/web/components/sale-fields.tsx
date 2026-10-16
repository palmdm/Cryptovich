"use client";

import { useId } from "react";
import { useLocale } from "./locale-provider";

/** The two fields of a sale: percent off (1–90, empty for none) and, optionally, until when. */
export function SaleFields({
  percent,
  endsAt,
  onChange,
}: {
  percent: string;
  endsAt: string;
  onChange: (next: { percent: string; endsAt: string }) => void;
}) {
  const { t } = useLocale();
  const id = useId();
  return (
    <div className="sale-fields">
      <div className="form-field">
        <label htmlFor={`${id}-percent`}>{t("sale.percent")}</label>
        <input
          id={`${id}-percent`}
          type="number"
          inputMode="numeric"
          min={1}
          max={90}
          step={1}
          value={percent}
          onChange={(e) => onChange({ percent: e.target.value, endsAt })}
        />
      </div>
      <div className="form-field">
        <label htmlFor={`${id}-ends`}>{t("sale.endsAt")}</label>
        <input id={`${id}-ends`} type="datetime-local" value={endsAt} disabled={!percent} onChange={(e) => onChange({ percent, endsAt: e.target.value })} />
      </div>
      <span className="meta sale-fields-hint">{t("sale.hint")}</span>
    </div>
  );
}
