import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 046: Add `oauthPicture` field to all existing users.
 *
 * Backfills:
 *   - oauthPicture: undefined (no existing OAuth picture URLs to recover)
 *
 * Idempotent: targets only users missing the field via `{ $exists: false }`.
 */
export async function up(mongoose: Mongoose) {
  logger.info("Starting migration: 046_add_oauth_picture_field...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("No active DB connection");

  const usersCollection = db.collection("users");

  const result = await usersCollection.updateMany(
    { oauthPicture: { $exists: false } },
    { $set: { oauthPicture: null } },
  );

  logger.info(`Set oauthPicture default on ${result.modifiedCount} users.`);
  logger.info("Migration 046 complete.");
}

export async function down(mongoose: Mongoose) {
  logger.info(
    "Rolling back migration 046: Removing oauthPicture from users...",
  );

  const db = mongoose.connection.db;
  if (!db) throw new Error("No active DB connection");

  await db.collection("users").updateMany({}, { $unset: { oauthPicture: "" } });

  logger.info("Rollback 046 complete.");
}
