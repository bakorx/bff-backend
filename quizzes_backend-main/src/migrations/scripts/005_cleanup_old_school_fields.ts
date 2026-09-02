import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration: Remove university-level fields from the `schools` collection.
 *
 * Background:
 *   After migration 003, documents in the `schools` collection that represented
 *   top-level institutions have been promoted to the `universities` collection.
 *   The `schools` collection now stores sub-level School entities (children of
 *   College in the new hierarchy: University → Campus → College → School → Dept).
 *
 *   Old university-level fields that must be removed from any remaining `schools`
 *   documents: `description`, `campuses`, `logo`, `website`, `settings`.
 *
 * Rollback: these fields are not recoverable once unset — restore from backup or
 *   re-run migration 003 to derive them from the `universities` collection.
 */
export async function up(mongoose: Mongoose) {
  logger.info("Removing university-level fields from old school documents...");

  const db = mongoose.connection.db;
  if (!db) {
    logger.info("No db object available. Ensure mongoose is connected.");
    return;
  }

  const schoolsCollection = db.collection("schools");

  const result = await schoolsCollection.updateMany(
    {
      $or: [
        { description: { $exists: true } },
        { campuses: { $exists: true } },
        { logo: { $exists: true } },
        { website: { $exists: true } },
        { settings: { $exists: true } },
      ],
    },
    {
      $unset: {
        description: "",
        campuses: "",
        logo: "",
        website: "",
        settings: "",
      },
    },
  );

  logger.info(
    `Cleaned university-level fields from ${result.modifiedCount} school document(s).`,
  );
}
