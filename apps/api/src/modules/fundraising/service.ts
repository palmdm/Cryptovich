import type { FundraisingGoal, PrismaClient } from "@platform/db";
import { Money, type Currency } from "@platform/shared";
import { Errors } from "../../lib/errors.js";
import { requireCreatorProfile } from "../products/product-helpers.js";
import type { CreateGoalInput, UpdateGoalInput } from "./schemas.js";

export interface GoalProgress {
  id: string;
  kind: "DONATIONS" | "SUBSCRIBERS";
  title: string;
  description: string | null;
  /** DONATIONS only. */
  currency: string | null;
  targetMinor: string | null;
  raisedMinor: string | null;
  /** SUBSCRIBERS only. */
  targetCount: number | null;
  currentCount: number | null;
  /** 0-100, clamped — a goal can be exceeded, but the bar never overfills. */
  percent: number;
  active: boolean;
  startsAt: Date;
  reachedAt: Date | null;
  completedAt: Date | null;
}

/**
 * Goals an author sets for their page — money from one-off payments, or a
 * number of paying subscribers. Progress is always measured from the rows
 * themselves, never stored: a rejected payment or a lapsed subscription
 * cannot leave a goal claiming more than is true.
 */
export class FundraisingService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Money raised since the goal started: COMPLETED donations and rewards
   * the author was given, in the goal's own currency. Payments in another currency are excluded rather than
   * converted — this platform holds no exchange rates, and quietly adding
   * EUR to a USD total would be a lie.
   */
  private async raisedFor(goal: { creatorId: string; currency: string | null; startsAt: Date }): Promise<bigint> {
    if (!goal.currency) return 0n;
    const since = { gte: goal.startsAt };
    // Tips, and what supporters paid for rewards — a reward bought with a
    // tip is its own row, so the two never count the same money twice.
    const [donations, rewards] = await Promise.all([
      this.prisma.donation.aggregate({
        where: { creatorId: goal.creatorId, status: "COMPLETED", currency: goal.currency, createdAt: since },
        _sum: { amountMinor: true },
      }),
      this.prisma.rewardGift.aggregate({
        where: { creatorId: goal.creatorId, status: "GRANTED", currency: goal.currency, createdAt: since },
        _sum: { amountMinor: true },
      }),
    ]);
    return (donations._sum?.amountMinor ?? 0n) + (rewards._sum?.amountMinor ?? 0n);
  }

  /** People paying for a subscription right now — each counted once, whatever tiers they hold. */
  private async payingSubscribers(creatorId: string): Promise<number> {
    const rows = await this.prisma.subscription.groupBy({
      by: ["userId"],
      where: { status: "ACTIVE", expiresAt: { gt: new Date() }, tier: { creatorId, amountMinor: { gt: 0n } } },
    });
    return rows.length;
  }

  private async withProgress(goal: FundraisingGoal): Promise<GoalProgress> {
    let percent = 0;
    let raised: bigint | null = null;
    let current: number | null = null;
    if (goal.kind === "SUBSCRIBERS") {
      current = await this.payingSubscribers(goal.creatorId);
      const target = goal.targetCount ?? 0;
      percent = target > 0 ? Math.min(100, Math.floor((current * 100) / target)) : 0;
    } else {
      raised = await this.raisedFor(goal);
      const target = goal.targetMinor ?? 0n;
      percent = target > 0n ? Math.min(100, Number((raised * 100n) / target)) : 0;
    }

    // Reached is recorded the first time it is seen, and kept: a goal that
    // got there got there, even if a subscriber leaves the next day.
    let reachedAt = goal.reachedAt;
    if (percent >= 100 && !reachedAt) {
      reachedAt = new Date();
      await this.prisma.fundraisingGoal.updateMany({ where: { id: goal.id, reachedAt: null }, data: { reachedAt } });
    }

    return {
      id: goal.id,
      kind: goal.kind,
      title: goal.title,
      description: goal.description,
      currency: goal.currency,
      targetMinor: goal.targetMinor?.toString() ?? null,
      raisedMinor: raised?.toString() ?? null,
      targetCount: goal.targetCount,
      currentCount: current,
      percent,
      active: goal.active,
      startsAt: goal.startsAt,
      reachedAt,
      completedAt: goal.completedAt,
    };
  }

  /**
   * Which of these goals have been met — recorded as reached, or marked
   * fulfilled by the author. One not yet recorded is measured now, which
   * records it if it has got there: a post locked on a goal opens on the
   * first read after the goal is met, with nothing to wait for.
   */
  async reachedGoalIds(goalIds: Iterable<string>): Promise<Set<string>> {
    const ids = [...new Set(goalIds)];
    const reached = new Set<string>();
    if (ids.length === 0) return reached;
    const goals = await this.prisma.fundraisingGoal.findMany({ where: { id: { in: ids } } });
    await Promise.all(
      goals.map(async (goal) => {
        if (goal.reachedAt || goal.completedAt || (await this.withProgress(goal)).percent >= 100) reached.add(goal.id);
      }),
    );
    return reached;
  }

  /** One goal with its progress, or null when it is gone. */
  async progressOf(goalId: string): Promise<GoalProgress | null> {
    const goal = await this.prisma.fundraisingGoal.findUnique({ where: { id: goalId } });
    return goal ? this.withProgress(goal) : null;
  }

  /** Public: the goals on an author's page — open ones, and the fulfilled ones beneath. */
  async listForCreator(username: string): Promise<{ goals: GoalProgress[]; completed: GoalProgress[] }> {
    const profile = await this.prisma.creatorProfile.findFirst({
      where: { user: { username, deletedAt: null } },
      select: { id: true },
    });
    if (!profile) return { goals: [], completed: [] };

    const [open, done] = await Promise.all([
      this.prisma.fundraisingGoal.findMany({ where: { creatorId: profile.id, active: true, completedAt: null }, orderBy: { createdAt: "desc" } }),
      this.prisma.fundraisingGoal.findMany({
        where: { creatorId: profile.id, active: true, completedAt: { not: null } },
        orderBy: { completedAt: "desc" },
        take: 10,
      }),
    ]);
    return {
      goals: await Promise.all(open.map((g) => this.withProgress(g))),
      completed: await Promise.all(done.map((g) => this.withProgress(g))),
    };
  }

  /** The author's own list, including goals they've switched off. */
  async listMine(userId: string): Promise<GoalProgress[]> {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const goals = await this.prisma.fundraisingGoal.findMany({ where: { creatorId: profile.id }, orderBy: { createdAt: "desc" } });
    return Promise.all(goals.map((g) => this.withProgress(g)));
  }

  async create(userId: string, input: CreateGoalInput): Promise<GoalProgress> {
    const profile = await requireCreatorProfile(this.prisma, userId);
    if (input.kind === "SUBSCRIBERS") {
      const goal = await this.prisma.fundraisingGoal.create({
        data: { creatorId: profile.id, kind: "SUBSCRIBERS", title: input.title, description: input.description, targetCount: input.targetCount },
      });
      return this.withProgress(goal);
    }
    const target = Money.fromDecimalString(input.targetDecimal, input.currency);
    if (target.isZero()) throw Errors.validation("A goal needs a target above zero.");
    const goal = await this.prisma.fundraisingGoal.create({
      data: {
        creatorId: profile.id,
        kind: "DONATIONS",
        title: input.title,
        description: input.description,
        targetMinor: target.amountMinor,
        currency: input.currency,
      },
    });
    return this.withProgress(goal);
  }

  async update(userId: string, goalId: string, input: UpdateGoalInput): Promise<GoalProgress> {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const existing = await this.prisma.fundraisingGoal.findUnique({ where: { id: goalId } });
    if (!existing || existing.creatorId !== profile.id) throw Errors.notFound("Goal");

    let targetMinor: bigint | undefined;
    let targetCount: number | undefined;
    if (existing.kind === "DONATIONS" && input.targetDecimal !== undefined) {
      targetMinor = Money.fromDecimalString(input.targetDecimal, existing.currency as Currency).amountMinor;
      if (targetMinor === 0n) throw Errors.validation("A goal needs a target above zero.");
    }
    if (existing.kind === "SUBSCRIBERS" && input.targetCount !== undefined) targetCount = input.targetCount;
    // A higher target can put a reached goal back in progress.
    const targetChanged = targetMinor !== undefined || targetCount !== undefined;

    const goal = await this.prisma.fundraisingGoal.update({
      where: { id: goalId },
      data: {
        title: input.title,
        description: input.description,
        targetMinor,
        targetCount,
        active: input.active,
        ...(targetChanged ? { reachedAt: null } : {}),
        ...(input.completed === undefined ? {} : { completedAt: input.completed ? existing.completedAt ?? new Date() : null }),
      },
    });
    return this.withProgress(goal);
  }

  async remove(userId: string, goalId: string): Promise<void> {
    const profile = await requireCreatorProfile(this.prisma, userId);
    const existing = await this.prisma.fundraisingGoal.findUnique({ where: { id: goalId } });
    if (!existing || existing.creatorId !== profile.id) throw Errors.notFound("Goal");
    // A post waiting on this goal would stay closed for good without it.
    const waiting = await this.prisma.digitalProduct.count({ where: { requiredGoalId: goalId, visibility: "GOAL", deletedAt: null } });
    if (waiting > 0) throw Errors.validation("Posts open when this goal is reached. Give them other access before deleting it.");
    await this.prisma.fundraisingGoal.delete({ where: { id: goalId } });
  }
}
