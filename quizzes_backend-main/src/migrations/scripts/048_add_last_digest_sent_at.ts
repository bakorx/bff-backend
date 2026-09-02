import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 048: Add `lastDigestSentAt` field to all existing users.
 *
 * Backfills:
 *   - lastDigestSentAt: null (users have never received a digest yet)
 *
 * Idempotent: targets only users missing the field via `{ $exists: false }`.
 */
export async function up(mongoose: Mongoose) {
  logger.info("Starting migration: 048_add_last_digest_sent_at...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("No active DB connection");

  const usersCollection = db.collection("users");

  const result = await usersCollection.updateMany(
    { lastDigestSentAt: { $exists: false } },
    { $set: { lastDigestSentAt: null } },
  );

  logger.info(
    `Set lastDigestSentAt default on ${result.modifiedCount} users.`,
  );
  logger.info("Migration 048 complete.");
}

export async function down(mongoose: Mongoose) {
  logger.info(
    "Rolling back migration 048: Removing lastDigestSentAt from users...",
  );

  const db = mongoose.connection.db;
  if (!db) throw new Error("No active DB connection");

  await db
    .collection("users")
    .updateMany({}, { $unset: { lastDigestSentAt: "" } });

  logger.info("Rollback 048 complete.");
}
