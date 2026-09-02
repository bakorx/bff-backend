import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 024: Make All Quizzes Available
 *
 * Strategy:
 *  1. Find the `quizzes` collection (which covers both Quiz and QuizQuestion models).
 *  2. Update all documents to set `isAvailable: true`.
 *  3. (Optional) Also handle `personalquizzes` if they have the flag, to ensure "all quizzes" are covered.
 */
export async function up(mongoose: Mongoose) {
  logger.info("[024] Starting migration: Making all quizzes available...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("[024] No db connection");

  const collections = (await db.listCollections().toArray()).map((c) => c.name);
  let totalUpdated = 0;

  // The 'quizzes' collection is the primary target for system-level quizzes
  if (collections.includes("quizzes")) {
    const quizzesCol = db.collection("quizzes");
    const result = await quizzesCol.updateMany(
      { isAvailable: { $ne: true } },
      { $set: { isAvailable: true } },
    );
    totalUpdated += result.modifiedCount;
    logger.info(
      `[024] Updated ${result.modifiedCount} documents in 'quizzes' collection.`,
    );
  }

  // Personal quizzes are stored in 'personalquizzes'. Although the schema prefers 'isPublic',
  // setting 'isAvailable' ensures consistency across "all" quiz types as requested.
  if (collections.includes("personalquizzes")) {
    const pqCol = db.collection("personalquizzes");
    const result = await pqCol.updateMany(
      { isAvailable: { $ne: true } },
      { $set: { isAvailable: true } },
    );
    totalUpdated += result.modifiedCount;
    logger.info(
      `[024] Updated ${result.modifiedCount} documents in 'personalquizzes' collection.`,
    );
  }

  logger.info(
    `[024] Migration complete. Total quiz documents updated: ${totalUpdated}`,
  );
}
