import { Mongoose } from "mongoose";
import { User } from "@/users/models";
import { logger } from "@/config";

export const dependsOn = ["039_fix_exam_reminder_days_calculation"];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const startOfUtcDay = (value: Date): number =>
  Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());

export async function up(_mongoose: Mongoose) {
  logger.info("Starting migration: 040_repair_streak_mismatch_from_longest...");

  const now = new Date();
  const todayUtcStart = startOfUtcDay(now);

  // Only consider users with a clear mismatch where current streak dropped below longest.
  const candidates = await User.find({
    "streak.lastStudyDate": { $ne: null },
    $expr: { $lt: ["$streak.currentCount", "$streak.longestStreak"] },
  })
    .select("streak")
    .lean();

  if (!candidates.length) {
    logger.info("[040] No streak mismatch candidates found");
    return;
  }

  let repaired = 0;
  let skipped = 0;

  for (const user of candidates) {
    const streak = user.streak;
    if (!streak?.lastStudyDate) {
      skipped += 1;
      continue;
    }

    const lastStudy = new Date(streak.lastStudyDate);
    const daysSinceLastStudy = Math.floor(
      (todayUtcStart - startOfUtcDay(lastStudy)) / MS_PER_DAY,
    );

    // Repair only active/recent streaks (today or yesterday) to avoid inflating old inactive accounts.
    if (daysSinceLastStudy < 0 || daysSinceLastStudy > 1) {
      skipped += 1;
      continue;
    }

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          "streak.currentCount": streak.longestStreak,
        },
      },
    );

    repaired += 1;
  }

  logger.info(
    `[040] Completed. candidates=${candidates.length}, repaired=${repaired}, skipped=${skipped}`,
  );
}

export async function down(_mongoose: Mongoose) {
  logger.info(
    "Down migration for 040: No-op (original pre-repair streak currentCount values are not recoverable).",
  );
}
