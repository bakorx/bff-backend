import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 045: Add OAuth-related fields to all existing users.
 *
 * Backfills:
 *   - linkedProviders: [] (empty array — no existing accounts are OAuth-linked)
 *   - emailVerified: false (legacy accounts don't have a verified-email assertion)
 *
 * Idempotent: targets only users missing the fields via `{ $exists: false }`.
 */
export async function up(mongoose: Mongoose) {
  logger.info("Starting migration: 045_add_oauth_provider_fields...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("No active DB connection");

  const usersCollection = db.collection("users");

  const result = await usersCollection.updateMany(
    {
      $or: [
        { linkedProviders: { $exists: false } },
        { emailVerified: { $exists: false } },
      ],
    },
    {
      $set: {
        linkedProviders: [],
        emailVerified: false,
      },
    },
  );

  logger.info(
    `Set linkedProviders/emailVerified defaults on ${result.modifiedCount} users.`,
  );
  logger.info("Migration 045 complete.");
}

export async function down(mongoose: Mongoose) {
  logger.info(
    "Rolling back migration 045: Removing OAuth provider fields from users...",
  );

  const db = mongoose.connection.db;
  if (!db) throw new Error("No active DB connection");

  await db.collection("users").updateMany(
    {},
    {
      $unset: {
        linkedProviders: "",
        emailVerified: "",
      },
    },
  );

  logger.info("Rollback 045 complete.");
}
