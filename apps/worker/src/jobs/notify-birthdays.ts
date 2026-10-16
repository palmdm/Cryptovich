import { prisma } from "@platform/db";
import { ageOn, isBirthdayOn, utcCalendarDate } from "@platform/shared";
import { parameter } from "../lib/parameters.js";

/**
 * The hour (UTC) from which a day's birthdays are announced: 09:00 UTC is
 * noon in Moscow and evening in Tokyo, where midnight UTC would have
 * pushed it to phones at three in the morning. The `birthdayNotifyHourUtc`
 * setting moves it (BIRTHDAY_NOTIFY_HOUR_UTC in .env until it is saved).
 */
export async function birthdayHourUtc(): Promise<number> {
  return Number(await parameter("birthdayNotifyHourUtc"));
}

/**
 * On an author's birthday, tells everyone subscribed to them — once a
 * year. The year is claimed by a conditional UPDATE in the same
 * transaction as the notifications, so a second worker, a restart or a
 * failed insert never sends it twice or loses it. The author is never
 * told about their own birthday, and the age is only mentioned when the
 * author shows their birth year.
 */
export async function notifyBirthdays(now = new Date()): Promise<number> {
  if (now.getUTCHours() < (await birthdayHourUtc())) return 0;
  const today = utcCalendarDate(now);
  const notYetThisYear = { OR: [{ birthdayNotifiedYear: null }, { birthdayNotifiedYear: { lt: today.year } }] };

  const candidates = await prisma.creatorProfile.findMany({
    where: { birthDate: { not: null }, ...notYetThisYear, user: { deletedAt: null, suspendedAt: null } },
    select: { id: true, userId: true, displayName: true, birthDate: true, showBirthYear: true, user: { select: { username: true } } },
  });

  let told = 0;
  for (const profile of candidates) {
    const born = utcCalendarDate(profile.birthDate!);
    if (!isBirthdayOn(born, today)) continue;
    told += await prisma.$transaction(async (tx) => {
      const claimed = await tx.creatorProfile.updateMany({
        where: { id: profile.id, ...notYetThisYear },
        data: { birthdayNotifiedYear: today.year },
      });
      if (claimed.count === 0) return 0;
      const subscribers = await tx.subscription.findMany({
        where: { status: "ACTIVE", expiresAt: { gt: now }, tier: { creatorId: profile.id }, userId: { not: profile.userId } },
        select: { userId: true },
        distinct: ["userId"],
      });
      if (subscribers.length === 0) return 0;
      await tx.notification.createMany({
        data: subscribers.map(({ userId }) => ({
          userId,
          type: "AUTHOR_BIRTHDAY",
          payload: {
            creatorUsername: profile.user.username,
            creatorName: profile.displayName,
            ...(profile.showBirthYear ? { age: ageOn(born, today) } : {}),
          },
        })),
      });
      return subscribers.length;
    });
  }
  return told;
}
