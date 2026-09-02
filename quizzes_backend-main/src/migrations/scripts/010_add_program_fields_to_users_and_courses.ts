import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 010: Backfill new program-related fields on existing users and courses.
 *
 * IUser changes:
 *   - enrolments: []            (refs to StudentEnrolment)
 *   - primaryEnrolmentId: null  (optional ref)
 *   - programSubscriptions: []  (refs to ProgramOfferingSubscription)
 *
 * ICourse changes:
 *   - programIds: []            (refs to ProgramOffering)
 *   - credits: null             (optional number)
 *   - courseCode: null          (optional string)
 *   - prerequisites: []         (refs to Course)
 *
 * Rollback:
 *   db.users.updateMany({}, { $unset: { enrolments: "", primaryEnrolmentId: "", programSubscriptions: "" } })
 *   db.courses.updateMany({}, { $unset: { programIds: "", credits: "", courseCode: "", prerequisites: "" } })
 */
export async function up(mongoose: Mongoose) {
  logger.info("[010] Backfilling program fields on users and courses...");

  const db = mongoose.connection.db;
  if (!db) {
    logger.info("[010] No db object available. Ensure mongoose is connected.");
    return;
  }

  const usersCol = db.collection("users");
  const coursesCol = db.collection("courses");

  // Backfill users — only update documents that don't yet have the new fields
  const userResult = await usersCol.updateMany(
    { enrolments: { $exists: false } },
    {
      $set: {
        enrolments: [],
        programSubscriptions: [],
      },
    },
  );
  logger.info(`[010] Users updated: ${userResult.modifiedCount}`);

  // Backfill courses — only update documents that don't yet have the new fields
  const courseResult = await coursesCol.updateMany(
    { programIds: { $exists: false } },
    {
      $set: {
        programIds: [],
        prerequisites: [],
      },
    },
  );
  logger.info(`[010] Courses updated: ${courseResult.modifiedCount}`);

  logger.info("[010] Done.");
}
