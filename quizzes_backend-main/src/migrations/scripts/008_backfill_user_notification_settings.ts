import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 008: Backfill default `notificationSettings` on IUser documents.
 *
 * The IUser interface now has an optional `notificationSettings` field.
 * This migration writes a safe default value for every user that does not
 * already have one, so application code can always read the field without
 * needing null-checks at the call site.
 *
 * Default values:
 *   - All toggleable categories: { email: true, inApp: true, push: true }
 *   - examReminders also gets reminderIntervals: [3, 1]
 *   - System categories (securityAlerts, accountActivity, systemUpdates):
 *     always { email: true, inApp: true, push: true } — user cannot disable
 *     these in the UI, but we store them as true for completeness.
 *
 * Rollback: $unset notificationSettings on all user documents.
 */
export async function up(mongoose: Mongoose) {
  logger.info("[008] Backfilling default notificationSettings on users...");

  const db = mongoose.connection.db;
  if (!db) {
    logger.info("[008] No db object available. Ensure mongoose is connected.");
    return;
  }

  const usersCol = db.collection("users");

  const defaultChannels = { email: true, inApp: true, push: true };

  const defaultNotificationSettings = {
    // User-toggleable
    examReminders: { ...defaultChannels, reminderIntervals: [3, 1] },
    quizAvailability: { ...defaultChannels },
    studyPartnerActivity: { ...defaultChannels },
    courseAnnouncements: { ...defaultChannels },
    recommendationUpdates: { ...defaultChannels },
    approvalStatusChanges: { ...defaultChannels },
    newsletter: { ...defaultChannels },
    // System / non-negotiable
    securityAlerts: { ...defaultChannels },
    accountActivity: { ...defaultChannels },
    systemUpdates: { ...defaultChannels },
  };

  const result = await usersCol.updateMany(
    { notificationSettings: { $exists: false } },
    { $set: { notificationSettings: defaultNotificationSettings } },
  );

  logger.info(
    `[008] Done. Backfilled notificationSettings on ${result.modifiedCount} user(s).`,
  );
}
