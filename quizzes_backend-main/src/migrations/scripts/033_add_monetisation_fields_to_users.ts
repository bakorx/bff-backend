import { Mongoose } from "mongoose";
import { nanoid } from "nanoid";
import { logger } from "@/config";

/**
 * Migration 033: Add monetisation fields to all existing users.
 * Backfills: planTier, planDuration, dailyUsage, credits, referralCode, referredBy.
 * Credits balance is seeded from the higher of quizCredits or aiUsageStats.creditsRemaining.
 */
export async function up(mongoose: Mongoose) {
  logger.info("Starting migration: 033_add_monetisation_fields_to_users...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("No active DB connection");

  const usersCollection = db.collection("users");

  // First pass: set flat defaults for all users missing the new fields
  const defaultDailyUsage = {
    date: new Date(0),
    tutorSessions: 0,
    quizGenerations: 0,
    flashcardSets: 0,
    mindMaps: 0,
    materialUploads: 0,
  };

  const bulkResult = await usersCollection.updateMany(
    { planTier: { $exists: false } },
    {
      $set: {
        planTier: null,
        planDuration: null,
        dailyUsage: defaultDailyUsage,
        referredBy: null,
      },
      $setOnInsert: {},
    },
  );

  logger.info(
    `Set planTier/planDuration/dailyUsage defaults on ${bulkResult.modifiedCount} users.`,
  );

  // Second pass: set credits.balance from legacy fields (one at a time to compute max)
  const usersWithoutCredits = await usersCollection
    .find({ "credits.balance": { $exists: false } })
    .toArray();

  let creditsBackfilled = 0;
  for (const user of usersWithoutCredits) {
    const legacyQuizCredits = (user.quizCredits as number) ?? 0;
    const legacyAiCredits =
      (user.aiUsageStats?.creditsRemaining as number) ?? 0;
    const balance = Math.max(legacyQuizCredits, legacyAiCredits, 0);

    await usersCollection.updateOne(
      { _id: user._id },
      {
        $set: {
          credits: {
            balance,
            lifetimeEarned: balance,
          },
        },
      },
    );
    creditsBackfilled++;
  }

  logger.info(`Backfilled credits.balance for ${creditsBackfilled} users.`);

  // Third pass: generate unique referral codes for users that don't have one
  const usersWithoutReferralCode = await usersCollection
    .find({ referralCode: { $exists: false } })
    .toArray();

  let referralCodesGenerated = 0;
  for (const user of usersWithoutReferralCode) {
    let code: string;
    let exists = true;

    // Ensure uniqueness
    do {
      code = nanoid(8).toUpperCase();
      const conflict = await usersCollection.findOne({ referralCode: code });
      exists = !!conflict;
    } while (exists);

    await usersCollection.updateOne(
      { _id: user._id },
      { $set: { referralCode: code } },
    );
    referralCodesGenerated++;
  }

  logger.info(`Generated referral codes for ${referralCodesGenerated} users.`);
  logger.info("Migration 033 complete.");
}

export async function down(mongoose: Mongoose) {
  logger.info(
    "Rolling back migration 033: Removing monetisation fields from users...",
  );

  const db = mongoose.connection.db;
  if (!db) throw new Error("No active DB connection");

  await db.collection("users").updateMany(
    {},
    {
      $unset: {
        planTier: "",
        planDuration: "",
        dailyUsage: "",
        credits: "",
        referralCode: "",
        referredBy: "",
      },
    },
  );

  logger.info("Rollback 033 complete.");
}
