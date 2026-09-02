import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 014: Post-migration cleanup.
 *
 * After verifying the contacts collection is fully populated and the app is
 * running cleanly on the new Contact model, run this script to:
 *  1. Drop the legacy `waitlists` collection.
 *  2. Drop the legacy `newslettersubscribers` collection.
 *
 * ⚠️  DO NOT run this migration until you have confirmed:
 *   - Migration 013 completed successfully with expected record counts.
 *   - The app has been running on the Contact model for at least one release cycle.
 *   - You have a full DB backup.
 */
export async function up(mongoose: Mongoose) {
  logger.info(
    "[014] Cleaning up legacy waitlists + newslettersubscribers collections…",
  );
  const db = mongoose.connection.db;
  if (!db) throw new Error("[014] No db connection");

  const collections = (await db.listCollections().toArray()).map((c) => c.name);

  if (collections.includes("waitlists")) {
    const count = await db.collection("waitlists").countDocuments();
    await db.collection("waitlists").drop();
    logger.info(`[014] Dropped 'waitlists' (${count} docs).`);
  } else {
    logger.info("[014] 'waitlists' already removed — skipping.");
  }

  if (collections.includes("newslettersubscribers")) {
    const count = await db.collection("newslettersubscribers").countDocuments();
    await db.collection("newslettersubscribers").drop();
    logger.info(`[014] Dropped 'newslettersubscribers' (${count} docs).`);
  } else {
    logger.info("[014] 'newslettersubscribers' already removed — skipping.");
  }

  logger.info("[014] Cleanup complete.");
}
