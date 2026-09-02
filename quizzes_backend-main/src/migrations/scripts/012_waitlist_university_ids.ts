import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 012: Backfill `universityId` on existing waitlist entries.
 *
 * Scans `waitlists` collection for records that have a string `university`
 * but miss an `universityId`. Resolves it via regex matching against `universities` names.
 */
export async function up(mongoose: Mongoose) {
  logger.info(
    "[012] Backfilling universityIds for existing waitlist entries...",
  );

  const db = mongoose.connection.db;
  if (!db) {
    logger.info("[012] No db object available. Ensure mongoose is connected.");
    return;
  }

  const waitlistsCol = db.collection("waitlists");
  const universitiesCol = db.collection("universities");

  // Find waitlist entries missing universityId but possessing a university string
  const cursor = waitlistsCol.find({
    universityId: { $exists: false },
    university: { $exists: true, $nin: [null, ""] },
  });

  let totalFound = 0;
  let updatedCount = 0;

  for await (const entry of cursor) {
    totalFound++;
    if (entry.university) {
      // Find matching university (case-insensitive regex)
      const matchedUni = await universitiesCol.findOne({
        name: { $regex: new RegExp(`^${entry.university.trim()}$`, "i") },
      });

      if (matchedUni) {
        await waitlistsCol.updateOne(
          { _id: entry._id },
          { $set: { universityId: matchedUni._id } },
        );
        logger.info(
          `[012] Matched '${entry.university}' -> University '${matchedUni.name}'`,
        );
        updatedCount++;
      }
    }
  }

  logger.info(
    `[012] Completed. Evaluated ${totalFound} entries, updated ${updatedCount}.`,
  );
}
