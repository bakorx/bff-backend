import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 064: Seed the timetable scraper selector flag.
 *
 * `use_sts_sync` selects the source of the periodic timetable sweep:
 *   - enabled (seeded default) → the school-wide STS scraper
 *     (sts.ug.edu.gh): needs no student IDs and returns every venue mapping
 *     with its full index range.
 *   - disabled → the per-student graduation API sweep across registered +
 *     crowdsourced student IDs.
 *
 * The school has deprecated one API before; this flag lets admins flip the
 * scraper from /admin/system/features without a deploy if it happens again.
 *
 * Idempotent: uses `updateOne` with `$setOnInsert`, so re-runs are a no-op
 * and later admin toggles survive a re-run.
 */
const FLAG = {
  key: "use_sts_sync",
  name: "Use STS Timetable Scraper",
  description:
    "Timetable sweep source: ON = school-wide STS scraper (sts.ug.edu.gh); OFF = per-student graduation API sweep across known student IDs.",
  type: "boolean",
} as const;

export async function up(mongoose: Mongoose) {
  logger.info("Starting migration: 064_seed_use_sts_sync_flag...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("No active DB connection");

  const flagsCollection = db.collection("featureflags");

  const result = await flagsCollection.updateOne(
    { key: FLAG.key },
    {
      $setOnInsert: {
        key: FLAG.key,
        name: FLAG.name,
        description: FLAG.description,
        type: FLAG.type,
        enabled: true,
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
    `Feature flag "${FLAG.key}": upserted=${result.upsertedCount}, modified=${result.modifiedCount}.`,
  );

  logger.info("Migration 064 complete.");
}

export async function down(mongoose: Mongoose) {
  logger.info(
    "Rolling back migration 064: Removing the use_sts_sync feature flag...",
  );

  const db = mongoose.connection.db;
  if (!db) throw new Error("No active DB connection");

  const result = await db
    .collection("featureflags")
    .deleteMany({ key: FLAG.key });

  logger.info(
    `Rolled back ${result.deletedCount} feature flag(s). ` +
      `Note: this also deletes any admin edits made since the migration ran.`,
  );
  logger.info("Rollback 064 complete.");
}
