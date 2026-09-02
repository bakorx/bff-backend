import { Mongoose } from "mongoose";
import { shortQueue } from "@/schedulers";
import { logger } from "@/config";

/**
 * Migration 039: Fix exam reminder daysUntil calculation
 *
 * Previous versions used Math.ceil() which rounded UP causing off-by-one errors.
 * This migration recalculates all pending exam_reminder jobs using the correct
 * calendar day logic that matches the frontend countdown display.
 */
export async function up(mongoose: Mongoose) {
  logger.info("Starting migration: 039_fix_exam_reminder_days_calculation...");

  try {
    const now = Date.now();
    const msPerHour = 1000 * 60 * 60;

    // Get all pending exam reminder jobs from the queue
    const states = ["delayed", "waiting", "active"] as const;
    const jobs = await shortQueue.getJobs([...states], 0, -1);

    if (!jobs || jobs.length === 0) {
      logger.info("[039] No pending exam reminder jobs found");
      return;
    }

    let updated = 0;
    let promoted = 0;
    let errors = 0;

    for (const job of jobs) {
      try {
        if (!job.data || job.name !== "push:exam_reminder") continue;

        const payload = job.data as {
          userId?: string;
          courseId?: string;
          courseCode?: string;
          courseName?: string;
          daysUntil?: number;
          examDate?: string;
          label?: string;
          venues?: any[];
        };

        if (!payload.examDate) continue;

        // Calculate calendar days away (matches frontend logic)
        const examDate = new Date(payload.examDate);
        const examStart = new Date(
          examDate.getFullYear(),
          examDate.getMonth(),
          examDate.getDate(),
        ).getTime();

        const nowDate = new Date(now);
        const nowStart = new Date(
          nowDate.getFullYear(),
          nowDate.getMonth(),
          nowDate.getDate(),
        ).getTime();

        const calendarDaysAway = Math.round(
          (examStart - nowStart) / (1000 * 60 * 60 * 24),
        );

        const msUntilExam = examDate.getTime() - now;
        const hoursUntilExam = msUntilExam / msPerHour;
        const examNotStarted = msUntilExam > 0;

        // Immediate-send rules requested:
        // 1) 1-day reminders should send immediately
        // 2) same-day reminders due within 2-5 hours should send immediately
        const shouldSendImmediately =
          examNotStarted &&
          (calendarDaysAway === 1 ||
            (calendarDaysAway === 0 &&
              hoursUntilExam >= 2 &&
              hoursUntilExam <= 5));

        // Only update if daysUntil changed
        if (calendarDaysAway !== payload.daysUntil) {
          const oldDaysUntil = payload.daysUntil;

          // Update the job payload
          payload.daysUntil = calendarDaysAway;

          // Update the job data
          await job.updateData(payload);

          updated++;
          logger.info(
            `[039] Fixed exam reminder for ${payload.courseCode}: ${oldDaysUntil} → ${calendarDaysAway} days`,
          );
        }

        if (shouldSendImmediately && typeof job.promote === "function") {
          await job.promote();
          promoted++;
          logger.info(
            `[039] Promoted exam reminder job ${job.id} for ${payload.courseCode} (daysUntil=${calendarDaysAway}, hoursUntil=${hoursUntilExam.toFixed(2)})`,
          );
        }
      } catch (err: any) {
        errors++;
        logger.error(`[039] Error processing job ${job.id}: ${err.message}`);
      }
    }

    logger.info(
      `[039] Migration completed. Updated: ${updated}, Promoted: ${promoted}, Errors: ${errors}`,
    );
  } catch (error: any) {
    logger.error(`[039] Migration failed: ${error.message}`);
    throw error;
  }
}

export async function down(mongoose: Mongoose) {
  logger.info(
    "[039] Downgrade not supported - exam reminder jobs are ephemeral and will be regenerated on next sync",
  );
}
