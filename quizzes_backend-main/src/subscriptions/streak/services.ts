import { Types } from "mongoose";
import { User } from "@/users";
import { runInTransaction } from "@/utils";
import { shortQueue } from "@/schedulers";

// Streak milestone thresholds
const MILESTONES = [7, 30, 60, 90] as const;

function todayUTC(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function yesterdayUTC(): Date {
  const t = todayUTC();
  t.setUTCDate(t.getUTCDate() - 1);
  return t;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/**
 * Records study activity for a user and updates their streak.
 * Called from session creation (app/services.ts).
 * Idempotent — calling multiple times on the same day is safe.
 */
export async function recordStudyActivity(
  userId: string | Types.ObjectId,
): Promise<void> {
  await runInTransaction(async (session) => {
    const user = await User.findById(userId).session(session);
    if (!user) return;

    // Paused during academic break — no-op
    if (user.streak?.pausedForBreak) return;

    const today = todayUTC();
    const yesterday = yesterdayUTC();
    const lastStudyDate = user.streak?.lastStudyDate
      ? new Date(user.streak.lastStudyDate)
      : null;

    // Already counted today — idempotent
    if (lastStudyDate && isSameDay(lastStudyDate, today)) return;

    let newCount = user.streak?.currentCount ?? 0;
    let restoreUsed = user.streak?.restoreUsedThisTerm ?? false;

    if (!lastStudyDate) {
      // First ever session
      newCount = 1;
    } else if (isSameDay(lastStudyDate, yesterday)) {
      // Consecutive day — extend streak
      newCount += 1;
    } else {
      // Missed at least one day — check forgiving renewal
      const daysMissed =
        Math.floor(
          (today.getTime() - lastStudyDate.getTime()) / (24 * 60 * 60 * 1000),
        ) - 1;

      if (daysMissed <= 2 && newCount >= 9 && !restoreUsed) {
        // Forgiving renewal: restore streak, mark restore used this term
        newCount += 1;
        restoreUsed = true;
        shortQueue.enqueue("notification:streak_restored", {
          userId: String(userId),
          streakCount: newCount,
        });
      } else {
        // Streak broken
        newCount = 1;
        restoreUsed = false;
      }
    }

    const longestStreak = Math.max(newCount, user.streak?.longestStreak ?? 0);

    // Check milestones
    const prevCount = user.streak?.currentCount ?? 0;
    for (const milestone of MILESTONES) {
      if (prevCount < milestone && newCount >= milestone) {
        if (milestone === 90) {
          // Permanent loyalty discount unlocked
          await User.updateOne(
            { _id: user._id },
            { $set: { "loyaltyDiscount.permanentPercentage": 15 } },
            { session },
          );
        }
        shortQueue.enqueue("notification:streak_milestone", {
          userId: String(userId),
          milestone,
          streakCount: newCount,
        });
      }
    }

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          "streak.currentCount": newCount,
          "streak.longestStreak": longestStreak,
          "streak.lastStudyDate": today,
          "streak.restoreUsedThisTerm": restoreUsed,
        },
      },
      { session },
    );
  });
}

/**
 * Uses one streak freeze for the user.
 * Sets lastStudyDate to today so tomorrow's check treats today as studied.
 */
export async function useStreakFreeze(userId: string): Promise<void> {
  await runInTransaction(async (session) => {
    const user = await User.findById(userId).session(session);
    if (!user) throw new Error("User not found");

    const freezes = user.streak?.freezesAvailable ?? 0;
    if (freezes <= 0)
      throw Object.assign(new Error("No streak freezes available"), {
        status: 400,
      });

    const today = todayUTC();

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          "streak.lastStudyDate": today,
          "streak.freezeUsedOnDate": today,
        },
        $inc: { "streak.freezesAvailable": -1 },
      },
      { session },
    );
  });
}

/**
 * Returns the streak status for a user.
 */
export async function getStreakStatus(userId: string) {
  const user = await User.findById(userId)
    .select("streak loyaltyDiscount")
    .lean();
  return {
    streak: user?.streak ?? null,
    loyaltyDiscount: user?.loyaltyDiscount ?? { permanentPercentage: 0 },
  };
}

/**
 * Resets restoreUsedThisTerm for all users at the start of each semester.
 * Called from the streak daily sweep when a new semester begins.
 */
export async function resetTermRestores(): Promise<number> {
  const result = await User.updateMany(
    { "streak.restoreUsedThisTerm": true },
    { $set: { "streak.restoreUsedThisTerm": false } },
  );
  return result.modifiedCount;
}

/**
 * Awards streak freezes based on plan tier on subscription activation.
 * Cooked: 0, Cruising: 1, Locked In: 2
 */
export function freezesForTier(tier: string): number {
  if (tier === "locked_in") return 2;
  if (tier === "cruising") return 1;
  return 0;
}
