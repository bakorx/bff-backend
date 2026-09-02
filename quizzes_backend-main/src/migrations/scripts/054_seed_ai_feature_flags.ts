import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 054: Seed AI Tiering & Model Feature Flags.
 *
 * Seeds:
 *   - ai_allow_free_users_paid_models: Feature flag allowing free/unsubscribed users to use paid models (GPT-4o/4o-mini).
 *   - ai_tier_override: Emergency/operational override ("auto" | "free" | "paid").
 *   - ai_provider: Preferred AI model provider priority ("openrouter" | "google" | "groq").
 *
 * Idempotent: uses `updateOne` with `$setOnInsert` per flag so re-runs are a no-op
 * and existing admin edits are preserved.
 */
const AI_FLAGS = [
  {
    key: "ai_allow_free_users_paid_models",
    name: "AI: Allow Free Users Paid Models",
    description:
      "Allows unsubscribed / free users to access paid AI models (e.g. GPT-4o, GPT-4o-mini).",
    type: "boolean",
    enabled: false,
    value: null,
    options: null,
  },
  {
    key: "ai_tier_override",
    name: "AI: Tier Override",
    description:
      "Emergency / operational override for AI model tiering across all users (auto = subscription based, free = force everyone to free tier, paid = force all to paid tier).",
    type: "select",
    enabled: true,
    value: "auto",
    options: ["auto", "free", "paid"],
  },
  {
    key: "ai_provider",
    name: "AI: Provider Priority",
    description:
      "Preferred AI model provider rotation priority (openrouter, google, groq).",
    type: "select",
    enabled: true,
    value: "openrouter",
    options: ["openrouter", "google", "groq"],
  },
] as const;

export async function up(mongoose: Mongoose) {
  logger.info("Starting migration: 054_seed_ai_feature_flags...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("No active DB connection");

  const flagsCollection = db.collection("featureflags");

  for (const flag of AI_FLAGS) {
    const result = await flagsCollection.updateOne(
      { key: flag.key },
      {
        $setOnInsert: {
          key: flag.key,
          name: flag.name,
          description: flag.description,
          type: flag.type,
          enabled: flag.enabled,
          value: flag.value,
          options: flag.options,
          config: null,
          updatedBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );

    logger.info(
      `AI Feature flag "${flag.key}": upserted=${result.upsertedCount}, modified=${result.modifiedCount}.`,
    );
  }

  logger.info("Migration 054 complete.");
}

export async function down(mongoose: Mongoose) {
  logger.info(
    "Rolling back migration 054: Removing AI feature flags...",
  );

  const db = mongoose.connection.db;
  if (!db) throw new Error("No active DB connection");

  const keys = AI_FLAGS.map((f) => f.key);
  const result = await db
    .collection("featureflags")
    .deleteMany({ key: { $in: keys } });

  logger.info(
    `Rolled back ${result.deletedCount} AI feature flags.`,
  );
  logger.info("Rollback 054 complete.");
}
