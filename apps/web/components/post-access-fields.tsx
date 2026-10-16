"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useLocale } from "./locale-provider";
import { SaleFields } from "./sale-fields";
import { fromLocalInput } from "@/lib/datetime-local";

export type PostVisibility = "PUBLIC" | "PURCHASED" | "SUBSCRIBERS" | "TIER" | "GOAL" | "PRIVATE";

/** Who may read a post: the choice the editor makes, as the form holds it. */
export interface PostAccess {
  visibility: PostVisibility;
  priceDecimal: string;
  requiredTierId: string;
  requiredGoalId: string;
  /** A sale on the price (PURCHASED only): percent as typed, until as a datetime-local value. */
  discountPercent: string;
  discountEndsAt: string;
}

export const OPEN_ACCESS: PostAccess = {
  visibility: "PUBLIC",
  priceDecimal: "0",
  requiredTierId: "",
  requiredGoalId: "",
  discountPercent: "",
  discountEndsAt: "",
};

/**
 * The access part of a post's create or update body. A tier or a goal
 * that does not apply to the chosen visibility is left out of a new post
 * (`undefined`) and cleared on an existing one (`null`).
 */
export function accessBody(access: PostAccess, cleared: null | undefined) {
  return {
    visibility: access.visibility,
    requiredTierId: access.visibility === "TIER" ? access.requiredTierId : cleared,
    requiredGoalId: access.visibility === "GOAL" ? access.requiredGoalId : cleared,
    currency: "USD",
    priceDecimal: access.visibility === "PURCHASED" ? access.priceDecimal : "0",
    discountPercent: access.visibility === "PURCHASED" && access.discountPercent ? Number(access.discountPercent) : cleared,
    discountEndsAt: access.visibility === "PURCHASED" && access.discountPercent ? fromLocalInput(access.discountEndsAt) ?? cleared : cleared,
  };
}

/** False while a tier or a goal still has to be picked. */
export function accessReady(access: PostAccess): boolean {
  if (access.visibility === "TIER") return Boolean(access.requiredTierId);
  if (access.visibility === "GOAL") return Boolean(access.requiredGoalId);
  return true;
}

interface Tier {
  id: string;
  name: string;
}

interface Goal {
  id: string;
  title: string;
  percent: number;
  reachedAt: string | null;
  completedAt: string | null;
}

/**
 * Access, and what it needs: a price for a paid post, a tier for a
 * tier-only one, a goal for one that opens when the goal is reached. One
 * component for writing a post and editing it, wherever either happens.
 */
export function PostAccessFields({ value, onChange }: { value: PostAccess; onChange: (next: PostAccess) => void }) {
  const { t } = useLocale();
  const id = useId();
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);

  useEffect(() => {
    apiFetch<{ tiers: Tier[] }>("/subscriptions/tiers/mine")
      .then((res) => setTiers(res.tiers))
      .catch(() => setTiers([]));
    apiFetch<{ goals: Goal[] }>("/fundraising/mine/all")
      .then((res) => setGoals(res.goals))
      .catch(() => setGoals([]));
  }, []);

  const set = (patch: Partial<PostAccess>) => onChange({ ...value, ...patch });
  const goal = goals.find((g) => g.id === value.requiredGoalId);

  return (
    <>
      <div className="form-field">
        <label htmlFor={`${id}-visibility`}>{t("common.access")}</label>
        <select id={`${id}-visibility`} value={value.visibility} onChange={(e) => set({ visibility: e.target.value as PostVisibility })}>
          <option value="PUBLIC">{t("newPost.accessPublic")}</option>
          <option value="PURCHASED">{t("newPost.accessPaid")}</option>
          <option value="SUBSCRIBERS">{t("newPost.accessSubscribers")}</option>
          <option value="TIER">{t("newPost.accessTier")}</option>
          <option value="GOAL">{t("newPost.accessGoal")}</option>
        </select>
      </div>
      {value.visibility === "PURCHASED" && (
        <div className="form-field">
          <label htmlFor={`${id}-price`}>{t("newPost.priceUsd")}</label>
          <input
            id={`${id}-price`}
            required
            pattern="\d+(\.\d{1,2})?"
            value={value.priceDecimal}
            onChange={(e) => set({ priceDecimal: e.target.value })}
          />
        </div>
      )}
      {value.visibility === "PURCHASED" && (
        <SaleFields
          percent={value.discountPercent}
          endsAt={value.discountEndsAt}
          onChange={(sale) => set({ discountPercent: sale.percent, discountEndsAt: sale.endsAt })}
        />
      )}
      {value.visibility === "TIER" && (
        <div className="form-field">
          <label htmlFor={`${id}-tier`}>{t("newPost.requiredTier")}</label>
          {tiers.length === 0 ? (
            <span className="lede">{t("newPost.noTiers")}</span>
          ) : (
            <select id={`${id}-tier`} required value={value.requiredTierId} onChange={(e) => set({ requiredTierId: e.target.value })}>
              <option value="" disabled>
                {t("newPost.selectTier")}
              </option>
              {tiers.map((tier) => (
                <option key={tier.id} value={tier.id}>
                  {tier.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {value.visibility === "GOAL" && (
        <div className="form-field">
          <label htmlFor={`${id}-goal`}>{t("newPost.requiredGoal")}</label>
          {goals.length === 0 ? (
            <span className="lede">
              {t("newPost.noGoals")} <Link href="/dashboard/organize">{t("newPost.createGoal")}</Link>
            </span>
          ) : (
            <>
              <select id={`${id}-goal`} required value={value.requiredGoalId} onChange={(e) => set({ requiredGoalId: e.target.value })}>
                <option value="" disabled>
                  {t("newPost.selectGoal")}
                </option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title} — {g.percent}%
                  </option>
                ))}
              </select>
              <span className="meta">
                {goal && (goal.reachedAt || goal.completedAt || goal.percent >= 100) ? t("newPost.goalAlreadyReached") : t("newPost.goalHint")}
              </span>
            </>
          )}
        </div>
      )}
    </>
  );
}
