"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useLocale } from "./locale-provider";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { CheckIcon } from "./icons";

export interface Goal {
  id: string;
  kind: "DONATIONS" | "SUBSCRIBERS";
  title: string;
  description: string | null;
  currency: string | null;
  targetMinor: string | null;
  raisedMinor: string | null;
  targetCount: number | null;
  currentCount: number | null;
  percent: number;
  active: boolean;
  reachedAt: string | null;
  completedAt: string | null;
}

/** "1 113 of 1 500 paying subscribers" / "$120 of $500 raised", as its parts. */
export function useGoalFigures(goal: Goal) {
  const { tn, t, locale } = useLocale();
  if (goal.kind === "SUBSCRIBERS") {
    const count = new Intl.NumberFormat(locale);
    return {
      current: count.format(goal.currentCount ?? 0),
      target: count.format(goal.targetCount ?? 0),
      // The noun agrees with the target: "of 1 paying subscriber", "of 1 500 …".
      unit: tn("goals.unitSubscribers", goal.targetCount ?? 0),
    };
  }
  return {
    current: formatMoney(goal.raisedMinor ?? "0", goal.currency ?? "USD"),
    target: formatMoney(goal.targetMinor ?? "0", goal.currency ?? "USD"),
    unit: t("goals.unitRaised"),
  };
}

/** The figures, a bar, and what the goal is for — Boosty's shape. */
export function GoalProgress({ goal }: { goal: Goal }) {
  const { t } = useLocale();
  const figures = useGoalFigures(goal);
  const reached = goal.reachedAt !== null || goal.percent >= 100;
  return (
    <div className="goal">
      <p className="goal-figures">
        <strong>{t("goals.of", { current: figures.current, target: figures.target })}</strong> <span>{figures.unit}</span>
      </p>
      <div
        className={`goal-bar${reached ? " is-reached" : ""}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={goal.percent}
        aria-label={goal.title}
      >
        <span style={{ width: `${goal.percent}%` }} />
      </div>
      <p className="goal-title">{goal.title}</p>
      {goal.description && <p className="goal-description meta">{goal.description}</p>}
      {reached && (
        <span className="badge goal-reached">
          <CheckIcon size={13} />
          {t("goals.reached")}
        </span>
      )}
    </div>
  );
}

/** The public block on an author's page. Renders nothing when there is no goal to show. */
export function FundraisingGoals({ username }: { username: string }) {
  const { t, locale } = useLocale();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [completed, setCompleted] = useState<Goal[]>([]);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ goals: Goal[]; completed?: Goal[] }>(`/fundraising/${username}`)
      .then((res) => {
        if (cancelled) return;
        setGoals(res.goals);
        setCompleted(res.completed ?? []);
      })
      .catch(() => !cancelled && setGoals([]));
    return () => {
      cancelled = true;
    };
  }, [username]);

  if (goals.length === 0 && completed.length === 0) return null;

  return (
    <section className="card stack goals" aria-labelledby="goals-heading" style={{ gap: 14 }}>
      <h2 id="goals-heading" className="goals-heading">
        {t("goals.title")} <span className="goals-count">{goals.length}</span>
      </h2>
      {goals.map((goal) => (
        <GoalProgress key={goal.id} goal={goal} />
      ))}
      {completed.length > 0 && (
        <details className="goals-done">
          <summary>{t("goals.completedTitle", { count: completed.length })}</summary>
          <ul>
            {completed.map((goal) => (
              <li key={goal.id}>
                <CheckIcon size={14} />
                <span>{goal.title}</span>
                {goal.completedAt && <span className="meta">{formatDate(goal.completedAt, locale)}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
