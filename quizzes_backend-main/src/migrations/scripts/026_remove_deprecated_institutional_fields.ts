import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 026: Remove deprecated institutional lineage fields.
 *
 * This migration unsets deptId, schoolId, collegeId, campusId, and universityId
 * across all core collections to align with the simplified architecture.
 */
export async function up(mongoose: Mongoose) {
  logger.info("[026] Starting migration to remove deprecated fields...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("[026] No db connection");

  // 1. Courses Cleanup
  logger.info("[026] Cleaning up courses...");
  const coursesResult = await db.collection("courses").updateMany(
    {},
    {
      $unset: {
        schoolId: "",
        campusId: "",
      },
    },
  );
  logger.info(`[026] Courses updated: ${coursesResult.modifiedCount}`);

  // 2. Personal Quizzes Cleanup
  logger.info("[026] Cleaning up personalquizzes...");
  const personalQuizzesResult = await db
    .collection("personalquizzes")
    .updateMany(
      {},
      {
        $unset: {
          deptId: "",
          schoolId: "",
          collegeId: "",
          campusId: "",
          universityId: "",
        },
      },
    );
  logger.info(
    `[026] Personal Quizzes updated: ${personalQuizzesResult.modifiedCount}`,
  );

  // 3. Recommendations Cleanup
  logger.info("[026] Cleaning up recommendations...");
  const recommendationsResult = await db
    .collection("recommendations")
    .updateMany(
      {},
      {
        $unset: {
          campusId: "",
          universityId: "",
        },
      },
    );
  logger.info(
    `[026] Recommendations updated: ${recommendationsResult.modifiedCount}`,
  );

  // 4. Notifications Cleanup
  logger.info("[026] Cleaning up notifications...");
  const notificationsResult = await db.collection("notifications").updateMany(
    {},
    {
      $unset: {
        universityId: "",
      },
    },
  );
  logger.info(
    `[026] Notifications updated: ${notificationsResult.modifiedCount}`,
  );

  logger.info("[026] Migration complete.");
}
