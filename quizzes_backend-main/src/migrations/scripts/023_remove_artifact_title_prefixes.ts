import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 023: Remove Artifact Title Prefixes
 *
 * Strategy:
 *  1. Find all documents in `artifacts` collection where `title` starts with "Flashcards - ", "Flashcards — ", "Quiz - ", or "Quiz — ".
 *  2. Remove those prefixes from the title string.
 *  3. Save the documents.
 */
export async function up(mongoose: Mongoose) {
  logger.info("[023] Validating artifact titles and cleaning up prefixes...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("[023] No db connection");

  const collections = (await db.listCollections().toArray()).map((c) => c.name);
  if (!collections.includes("artifacts")) {
    logger.info("[023] No artifacts collection found. Exiting.");
    return;
  }
  const artifactsCol = db.collection("artifacts");

  // Regex matches exact prefixes: "Flashcard Set - ", "Flashcards — ", "Quiz - ", "Quiz — "
  const prefixRegex = /^(Flashcard Set|Flashcards|Quiz)\s*[-—]\s*/i;

  const cursor = artifactsCol.find({
    title: { $regex: prefixRegex },
  });

  let migrated = 0;
  let skipped = 0;

  for await (const doc of cursor) {
    if (typeof doc.title === "string") {
      const newTitle = doc.title.replace(prefixRegex, "").trim();

      if (newTitle !== doc.title) {
        await artifactsCol.updateOne(
          { _id: doc._id },
          { $set: { title: newTitle } },
        );
        migrated++;
        logger.info(
          `[023] Updated artifact ${doc._id}. Title: "${doc.title}" -> "${newTitle}"`,
        );
      } else {
        skipped++;
      }
    } else {
      skipped++;
    }
  }

  // Also update PersonalQuiz titles
  if (collections.includes("personalquizzes")) {
    const pqCol = db.collection("personalquizzes");
    const pqCursor = pqCol.find({ title: { $regex: prefixRegex } });
    for await (const doc of pqCursor) {
      if (typeof doc.title === "string") {
        const newTitle = doc.title.replace(prefixRegex, "").trim();
        if (newTitle !== doc.title) {
          await pqCol.updateOne(
            { _id: doc._id },
            { $set: { title: newTitle } },
          );
          migrated++;
          logger.info(
            `[023] Updated personal quiz ${doc._id}. Title: "${doc.title}" -> "${newTitle}"`,
          );
        }
      }
    }
  }

  // Also update FlashcardSet titles
  if (collections.includes("flashcardsets")) {
    const fsCol = db.collection("flashcardsets");
    const fsCursor = fsCol.find({ title: { $regex: prefixRegex } });
    for await (const doc of fsCursor) {
      if (typeof doc.title === "string") {
        const newTitle = doc.title.replace(prefixRegex, "").trim();
        if (newTitle !== doc.title) {
          await fsCol.updateOne(
            { _id: doc._id },
            { $set: { title: newTitle } },
          );
          migrated++;
          logger.info(
            `[023] Updated flashcard set ${doc._id}. Title: "${doc.title}" -> "${newTitle}"`,
          );
        }
      }
    }
  }

  logger.info(
    `[023] Migration complete. Titles cleaned up: ${migrated}, Skipped: ${skipped}`,
  );
}
