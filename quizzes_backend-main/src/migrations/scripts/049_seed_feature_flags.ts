import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 049: Seed the starter feature flags.
 *
 * Creates the three flags the system needs out-of-the-box so admins don't
 * have to set them up by hand before the new flag system is usable:
 *
 *   - study_rooms_enabled       — gates `POST /api/v1/study-rooms` (was ENABLE_STUDY_ROOMS env var)
 *   - public_preexam_autogen    — gates the `quiz:public_preexam_sweep` cron (was ENABLE_PUBLIC_PREEXAM_QUIZ_AUTOGEN)
 *   - weekly_digest_enabled     — gates the `email:weekly_digest` handler
 *
 * All three start **disabled**. Admins flip them on via
 * /admin/system/features after deploy.
 *
 * Idempotent: uses `updateOne` with `$setOnInsert` per flag, so re-runs are
 * a no-op. Crucially, `$setOnInsert` means admins' later toggles survive
 * a re-run of this migration — only the initial seed values are inserted
 * when a flag is missing.
 */
const STARTER_FLAGS = [
  {
    key: "study_rooms_enabled",
    name: "Study Rooms",
    description:
      "Enables the Study Rooms feature (create/join live study sessions).",
    type: "boolean",
  },
  {
    key: "public_preexam_autogen",
    name: "Public Pre-Exam Quiz Auto-Generation",
    description:
      "Daily 06:00 UTC sweep that auto-generates public pre-exam quizzes from library materials for upcoming exams.",
    type: "boolean",
  },
  {
    key: "weekly_digest_enabled",
    name: "Weekly Study Digest",
    description:
      "Monday 08:00 UTC cron that sends opt-in users an email summary of their study activity over the last 7 days.",
    type: "boolean",
  },
] as const;

export async function up(mongoose: Mongoose) {
  logger.info("Starting migration: 049_seed_feature_flags...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("No active DB connection");

  const flagsCollection = db.collection("featureflags");

  for (const flag of STARTER_FLAGS) {
    const result = await flagsCollection.updateOne(
      { key: flag.key },
      {
        $setOnInsert: {
          key: flag.key,
          name: flag.name,
          description: flag.description,
          type: flag.type,
          enabled: false,
          value: null,
          options: null,
          config: null,
          updatedBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );

    logger.info(
      `Feature flag "${flag.key}": upserted=${result.upsertedCount}, modified=${result.modifiedCount}.`,
    );
  }

  logger.info("Migration 049 complete.");
}

export async function down(mongoose: Mongoose) {
  logger.info(
    "Rolling back migration 049: Removing starter feature flags...",
  );

  const db = mongoose.connection.db;
  if (!db) throw new Error("No active DB connection");

  const keys = STARTER_FLAGS.map((f) => f.key);
  const result = await db
    .collection("featureflags")
    .deleteMany({ key: { $in: keys } });

  logger.info(
    `Rolled back ${result.deletedCount} starter feature flags. ` +
      `Note: this also deletes any admin edits made since the migration ran.`,
  );
  logger.info("Rollback 049 complete.");
}
