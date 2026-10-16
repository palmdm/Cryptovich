"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { useLocale } from "./locale-provider";
import { GoalProgress, type Goal } from "./fundraising-goal";
import { Loading } from "@/components/loading";
import { UsersIcon, WalletIcon } from "./icons";

type Kind = Goal["kind"];

const CURRENCIES = ["USD", "EUR", "USDT", "USDC", "BTC", "ETH"] as const;

/**
 * The author's goals: what each one counts (paying subscribers, or money
 * from one-off payments), its target and what it is for — then its
 * progress, and the author's "done" once the promise behind it is kept.
 */
export function FundraisingManager() {
  const { t } = useLocale();
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [kind, setKind] = useState<Kind>("SUBSCRIBERS");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetCount, setTargetCount] = useState("");
  const [targetDecimal, setTargetDecimal] = useState("");
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>("USD");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setGoals((await apiFetch<{ goals: Goal[] }>("/fundraising/mine/all")).goals);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("goals.loadError"));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const target =
        kind === "SUBSCRIBERS" ? { targetCount: Number(targetCount) } : { targetDecimal: targetDecimal.trim(), currency };
      await apiFetch("/fundraising", {
        method: "POST",
        body: JSON.stringify({ kind, title: title.trim(), description: description.trim() || undefined, ...target }),
      });
      setTitle("");
      setDescription("");
      setTargetCount("");
      setTargetDecimal("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("goals.createError"));
    } finally {
      setBusy(false);
    }
  }

  async function change(goal: Goal, body: Record<string, unknown>) {
    setError(null);
    try {
      await apiFetch(`/fundraising/${goal.id}`, { method: "PATCH", body: JSON.stringify(body) });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("goals.updateError"));
    }
  }

  async function remove(goal: Goal) {
    if (!window.confirm(t("goals.deleteConfirm", { title: goal.title }))) return;
    setError(null);
    try {
      await apiFetch(`/fundraising/${goal.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("goals.deleteError"));
    }
  }

  const kinds: { id: Kind; icon: typeof UsersIcon; label: string }[] = [
    { id: "SUBSCRIBERS", icon: UsersIcon, label: t("goals.kind.SUBSCRIBERS") },
    { id: "DONATIONS", icon: WalletIcon, label: t("goals.kind.DONATIONS") },
  ];

  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>{t("goals.title")}</h2>
      <p className="lede" style={{ margin: 0 }}>
        {t("goals.lede")}
      </p>
      {error && <div className="error-banner">{error}</div>}

      <form className="stack" style={{ gap: 12 }} onSubmit={create}>
        <div className="goal-kinds" role="radiogroup" aria-label={t("goals.kindLabel")}>
          {kinds.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={kind === id}
              className={`goal-kind${kind === id ? " selected" : ""}`}
              onClick={() => setKind(id)}
            >
              <Icon size={30} />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {kind === "SUBSCRIBERS" ? (
          <div className="form-field">
            <label htmlFor="goal-count">{t("goals.targetCount")}</label>
            <input
              id="goal-count"
              required
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              placeholder="1500"
              value={targetCount}
              onChange={(e) => setTargetCount(e.target.value)}
            />
          </div>
        ) : (
          <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
            <div className="form-field" style={{ flex: 1, minWidth: 140 }}>
              <label htmlFor="goal-amount">{t("goals.targetAmount")}</label>
              <input
                id="goal-amount"
                required
                inputMode="decimal"
                pattern="\d+(\.\d{1,2})?"
                placeholder="500"
                value={targetDecimal}
                onChange={(e) => setTargetDecimal(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="goal-currency">{t("goals.currency")}</label>
              <select id="goal-currency" value={currency} onChange={(e) => setCurrency(e.target.value as typeof currency)}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="form-field">
          <label htmlFor="goal-title">{t("goals.titleField")}</label>
          <input
            id="goal-title"
            required
            maxLength={120}
            placeholder={t("goals.titlePlaceholder")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor="goal-desc">{t("goals.descriptionField")}</label>
          <textarea
            id="goal-desc"
            rows={2}
            maxLength={500}
            placeholder={t("goals.descriptionPlaceholder")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <button className="primary" type="submit" disabled={busy} style={{ alignSelf: "flex-start" }}>
          {busy ? t("common.creating") : t("goals.create")}
        </button>
      </form>

      {goals === null && <Loading />}
      {goals?.length === 0 && <div className="empty-state">{t("goals.empty")}</div>}
      {goals && goals.length > 0 && (
        <div className="stack" style={{ gap: 12 }}>
          {goals.map((goal) => (
            <div key={goal.id} className="goal-manage">
              <GoalProgress goal={goal} />
              <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {!goal.active && <span className="badge">{t("goals.hidden")}</span>}
                {goal.completedAt && <span className="badge goal-done-badge">{t("goals.completed")}</span>}
                <span style={{ flex: 1 }} />
                {goal.completedAt ? (
                  <button className="secondary" onClick={() => change(goal, { completed: false })}>
                    {t("goals.reopen")}
                  </button>
                ) : (
                  <button className="secondary" onClick={() => change(goal, { completed: true })}>
                    {t("goals.complete")}
                  </button>
                )}
                <button className="secondary" onClick={() => change(goal, { active: !goal.active })}>
                  {goal.active ? t("goals.hide") : t("goals.show")}
                </button>
                <button className="danger" onClick={() => remove(goal)}>
                  {t("common.delete")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
