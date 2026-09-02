import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 047: Remove `uiPreferences` from all users.
 *
 * The UI preferences subsystem has been removed from the application:
 *   - Backend: `users/{models,interfaces,serializers,controllers,routes}`,
 *     `utils/ui`, and all `resolveUserUiSettings()` callers.
 *   - Frontend: `lib/ui-preferences`, `hooks/common/use-ui-preferences`,
 *     and the related admin campaigns / EmailPreview consumers.
 *
 * This migration scrubs the persisted field from every user document so
 * we don't leave stale schema-less keys behind.
 *
 * Idempotent: targets only users still carrying the field via
 * `{ $exists: true }`, so reruns are a no-op.
 */
export async function up(mongoose: Mongoose) {
  logger.info("Starting migration: 047_remove_ui_preferences...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("No active DB connection");

  const usersCollection = db.collection("users");

  const result = await usersCollection.updateMany(
    { uiPreferences: { $exists: true } },
    { $unset: { uiPreferences: "" } },
  );

  logger.info(
    `Removed uiPreferences from ${result.modifiedCount} users (matched=${result.matchedCount}).`,
  );
  logger.info("Migration 047 complete.");
}

export async function down(_mongoose: Mongoose) {
  logger.warn(
    "Rollback 047: uiPreferences cannot be restored (the field was removed). No-op.",
  );
}
