import { Mongoose } from "mongoose";
import crypto from "crypto";
import { logger } from "@/config";

/**
 * Migration 017: Migrate flat per-card Flashcard documents to the new
 * per-set FlashcardSet model with embedded cards.
 *
 * OLD shape (`flashcards` collection — one document per card):
 *   { _id, courseId, materialId, front, back, lectureNumber, createdBy,
 *     isPublic, tags: string[], difficulty, lastReviewed?, reviewCount,
 *     masteryLevel, createdAt, updatedAt }
 *
 * NEW shape (`flashcardsets` collection — one document per set, cards embedded):
 *   { _id, title, description?, courseId, materialId?, createdBy,
 *     isPublic, tags: string[] (union of all card tags),
 *     cards: [ { cardId, front, back, tags, difficulty, lastReviewed?,
 *                reviewCount, masteryLevel } ],
 *     cardCount, createdAt, updatedAt }
 *
 * Strategy:
 *   1. Group all old Flashcard documents by (createdBy, courseId, materialId).
 *      Each unique combination becomes one FlashcardSet.
 *   2. Within each group, embed every card with a generated cardId (UUID v4).
 *   3. Set-level `tags` = union of all card tags.
 *   4. Set-level `isPublic` = true if ANY card in the group was public.
 *   5. `title` is derived from the lectureNumber of the first card in the group
 *      (e.g. "Flashcard Set – Lecture 3"), falling back to "Imported Flashcard Set".
 *   6. After successful insertion of all sets, drop the legacy `flashcards` collection.
 *
 * Safety:
 *   - The migration is idempotent: it skips insertion if the `flashcardsets`
 *     collection already contains documents for a given (createdBy, courseId)
 *     combination (detected via a count check before processing).
 *   - The old `flashcards` collection is only dropped after all inserts succeed.
 *   - A full DB backup is strongly recommended before running this migration.
 */
export async function up(mongoose: Mongoose) {
  logger.info("[017] Migrating Flashcard documents to FlashcardSet...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("[017] No db connection");

  const flashcardsCol = db.collection("flashcards");
  const flashcardSetsCol = db.collection("flashcardsets");

  // Check if there is anything to migrate
  const oldCount = await flashcardsCol.countDocuments();
  if (oldCount === 0) {
    logger.info("[017] No documents in 'flashcards' — nothing to migrate.");
    return;
  }
  logger.info(`[017] Found ${oldCount} old Flashcard document(s) to migrate.`);

  // Group cards by (createdBy, courseId, materialId)
  // Using the native aggregation pipeline for efficiency
  const groups = await flashcardsCol
    .aggregate([
      {
        $group: {
          _id: {
            createdBy: "$createdBy",
            courseId: "$courseId",
            materialId: { $ifNull: ["$materialId", null] },
          },
          cards: {
            $push: {
              originalId: "$_id",
              front: "$front",
              back: "$back",
              tags: { $ifNull: ["$tags", []] },
              difficulty: { $ifNull: ["$difficulty", "medium"] },
              lastReviewed: "$lastReviewed",
              reviewCount: { $ifNull: ["$reviewCount", 0] },
              masteryLevel: { $ifNull: ["$masteryLevel", 0] },
              lectureNumber: "$lectureNumber",
              isPublic: { $ifNull: ["$isPublic", false] },
              createdAt: "$createdAt",
            },
          },
          anyPublic: { $max: "$isPublic" },
          firstLectureNumber: { $first: "$lectureNumber" },
          createdAt: { $min: "$createdAt" },
          updatedAt: { $max: "$updatedAt" },
        },
      },
    ])
    .toArray();

  logger.info(`[017] Grouped into ${groups.length} FlashcardSet(s).`);

  let setsInserted = 0;
  let groupsSkipped = 0;

  for (const group of groups) {
    const { createdBy, courseId, materialId } = group._id;

    // Idempotency check: skip if any set for this (createdBy, courseId, materialId)
    // combination already exists. This prevents duplicate sets on re-runs.
    // Note: if a previous run inserted chunk 1 but crashed before chunk 2, those
    // remaining chunks will also be skipped. In that rare case, manually remove the
    // partial sets and re-run the migration.
    const existingCount = await flashcardSetsCol.countDocuments({
      createdBy,
      courseId,
      ...(materialId ? { materialId } : {}),
    });

    if (existingCount > 0) {
      groupsSkipped++;
      continue;
    }

    // Build the embedded cards array
    const cards = (group.cards as any[]).map((c) => ({
      cardId: crypto.randomUUID(),
      front: c.front ?? "",
      back: c.back ?? "",
      tags: Array.isArray(c.tags) ? c.tags : [],
      difficulty: c.difficulty ?? "medium",
      ...(c.lastReviewed ? { lastReviewed: c.lastReviewed } : {}),
      reviewCount: c.reviewCount ?? 0,
      masteryLevel: Math.min(100, Math.max(0, c.masteryLevel ?? 0)),
    }));

    // Enforce the 50-card cap: split into multiple sets if necessary
    const chunks: (typeof cards)[] = [];
    for (let i = 0; i < cards.length; i += 50) {
      chunks.push(cards.slice(i, i + 50));
    }

    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
      const chunk = chunks[chunkIdx];
      const setTags = [...new Set(chunk.flatMap((c) => c.tags))];
      const isPublic = group.anyPublic === true;
      const lectureLabel = group.firstLectureNumber
        ? `Lecture ${group.firstLectureNumber}`
        : null;
      const chunkSuffix = chunks.length > 1 ? ` (Part ${chunkIdx + 1})` : "";
      const title = lectureLabel
        ? `Flashcard Set – ${lectureLabel}${chunkSuffix}`
        : `Imported Flashcard Set${chunkSuffix}`;

      await flashcardSetsCol.insertOne({
        title,
        courseId,
        ...(materialId ? { materialId } : {}),
        createdBy,
        isPublic,
        tags: setTags,
        cards: chunk,
        cardCount: chunk.length,
        createdAt: group.createdAt ?? new Date(),
        updatedAt: group.updatedAt ?? new Date(),
      });

      setsInserted++;
    }
  }

  logger.info(
    `[017] FlashcardSets inserted: ${setsInserted}, groups already up-to-date (skipped): ${groupsSkipped}.`,
  );

  // Drop the legacy collection only after all sets have been written successfully
  const collections = (await db.listCollections().toArray()).map((c) => c.name);
  if (collections.includes("flashcards")) {
    await flashcardsCol.drop();
    logger.info(`[017] Dropped legacy 'flashcards' collection.`);
  } else {
    logger.info(
      "[017] 'flashcards' collection already removed — skipping drop.",
    );
  }

  logger.info("[017] Migration complete.");
}
