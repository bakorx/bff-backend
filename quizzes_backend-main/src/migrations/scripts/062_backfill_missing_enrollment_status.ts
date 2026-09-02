import { Mongoose } from "mongoose";
import { UserCourseEnrollment } from "@/learning/models";
import { logger } from "@/config";

/**
 * Migration 062: Backfill the missing `status` field on UserCourseEnrollment.
 *
 * A large cohort of enrollments (all from the 2025-2026 academic year) was
 * created by an older write path that omitted `status` from its `$setOnInsert`,
 * so those documents have no `status` field at all. Every read path filters on
 * `status: "active"`, so a missing `status` makes an enrollment invisible —
 * the root cause of users' courses silently disappearing from the dashboard
 * and `/users/me/courses`.
 *
 * The 2026-2027 academic year has since started, so the entire affected cohort
 * (all previous-year enrollments) is marked `completed` rather than `active`.
 * Current write paths always set `status`, so no new missing-status documents
 * are created. This migration is idempotent: it only touches documents whose
 * `status` is absent/null.
 */
export async function up(mongoose: Mongoose) {
  logger.info("Starting migration: 062_backfill_missing_enrollment_status...");

  const missingStatusFilter = {
    $or: [{ status: { $exists: false } }, { status: null }],
  };

  const affected = await UserCourseEnrollment.countDocuments(missingStatusFilter);
  logger.info(
    `[Enrollment Backfill] Found ${affected} enrollment(s) missing a status field`,
  );

  if (affected === 0) {
    logger.info("[Enrollment Backfill] Nothing to backfill; skipping.");
    return;
  }

  const result = await UserCourseEnrollment.updateMany(missingStatusFilter, {
    $set: { status: "completed" },
  });

  logger.info(
    `[Enrollment Backfill] Set status="completed" on ${result.modifiedCount} enrollment(s)`,
  );
}

export async function down(mongoose: Mongoose) {
  logger.info(
    "[Enrollment Backfill] Down migration: no-op. The original documents had no status value to restore.",
  );
}
