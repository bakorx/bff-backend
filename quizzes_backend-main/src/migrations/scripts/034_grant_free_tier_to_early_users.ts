import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 034: Reset all early users.
 * - Targets users created before April 5th, 2026.
 * - Invalidates all existing active subscriptions for these users.
 * - Resets their plan status to default (no active plan).
 * - Divides existing credits by 10.
 */
export async function up(mongoose: Mongoose) {
  logger.info("Starting migration: 034_reset_early_users...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("No active DB connection");

  const cutOffDate = new Date("2026-04-05T00:00:00.000Z");

  const usersCollection = db.collection("users");
  const subscriptionsCollection = db.collection("subscriptions");

  const earlyUsers = await usersCollection
    .find({ createdAt: { $lt: cutOffDate } })
    .toArray();

  let resetCount = 0;

  for (const user of earlyUsers) {
    const now = new Date();

    // 1. Invalidate any existing active subscriptions
    await subscriptionsCollection.updateMany(
      { userId: user._id, status: "active" },
      { $set: { status: "cancelled", updatedAt: now } },
    );

    // 2. Divide existing credits by 10
    const currentBalance = (user.credits?.balance as number) || 0;
    const currentLifetime = (user.credits?.lifetimeEarned as number) || 0;

    const newBalance = Math.max(0, Math.floor(currentBalance / 10));
    const newLifetime = Math.max(0, Math.floor(currentLifetime / 10));

    // 3. Reset user to defaults (no free subscription created)
    await usersCollection.updateOne(
      { _id: user._id },
      {
        $set: {
          planTier: null,
          planDuration: null,
          isSubscribed: false,
          "credits.balance": newBalance,
          "credits.lifetimeEarned": newLifetime,
          updatedAt: now,
        },
      },
    );

    resetCount++;
  }

  logger.info(
    `Force-reset ${resetCount} users: cancelled active subs, restored default billing flags, and divided credits by 10.`,
  );
  logger.info("Migration 034 complete.");
}

export async function down(mongoose: Mongoose) {
  logger.info(
    "Rolling back migration 034: (Partial operation. Subscriptions remain cancelled).",
  );
  logger.info(
    "Credits were irreversibly divided by 10 unless a DB snapshot is restored.",
  );
}
