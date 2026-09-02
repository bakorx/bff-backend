import { Mongoose, Types } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 027: Merge duplicate personal quizzes and flashcards.
 *
 * This migration identifies duplicate PersonalQuizzes and FlashcardSets
 * for each user based on courseId (primary) or materialId (secondary).
 * It merges their contents into the most recently updated document and
 * deletes the redundant duplicates.
 */
export async function up(mongoose: Mongoose) {
  const db = mongoose.connection.db;
  if (!db) throw new Error("[027] No db connection");

  // --- 1. FLASHCARD SETS MERGE ---
  logger.info("[027] Starting FlashcardSet merge...");
  const flashcardGroups = await db
    .collection("flashcardsets")
    .aggregate([
      {
        $group: {
          _id: {
            createdBy: "$createdBy",
            // Prioritize courseId if available, fallback to materialId
            target: { $ifNull: ["$courseId", "$materialId"] },
          },
          ids: { $push: "$_id" },
          count: { $sum: 1 },
        },
      },
      { $match: { "_id.target": { $ne: null }, count: { $gt: 1 } } },
    ])
    .toArray();

  for (const group of flashcardGroups) {
    const docs = await db
      .collection("flashcardsets")
      .find({ _id: { $in: group.ids } })
      .sort({ updatedAt: -1 })
      .toArray();

    const [kept, ...duplicates] = docs;
    logger.info(
      `[027] Merging ${duplicates.length} duplicates into FlashcardSet ${kept._id} (User: ${group._id.createdBy})`,
    );

    const allCards = [...(kept.cards || [])];
    for (const dup of duplicates) {
      if (dup.cards) {
        allCards.push(...dup.cards);
      }
    }

    // De-duplicate cards by front and back text
    const uniqueCards = [];
    const cardKeys = new Set<string>();
    for (const card of allCards) {
      if (!card.front || !card.back) continue;
      const key = `${card.front.trim().toLowerCase()}|||${card.back.trim().toLowerCase()}`;
      if (!cardKeys.has(key)) {
        cardKeys.add(key);
        uniqueCards.push(card);
      }
    }

    await db.collection("flashcardsets").updateOne(
      { _id: kept._id },
      {
        $set: {
          cards: uniqueCards,
          cardCount: uniqueCards.length,
          isDeleted: false,
        },
      },
    );

    await db
      .collection("flashcardsets")
      .deleteMany({ _id: { $in: duplicates.map((d) => d._id) } });
  }
  logger.info(
    `[027] FlashcardSet merge completed for ${flashcardGroups.length} groups.`,
  );

  // --- 2. PERSONAL QUIZZES MERGE ---
  logger.info("[027] Starting PersonalQuiz merge...");
  const quizGroups = await db
    .collection("personalquizzes")
    .aggregate([
      {
        $group: {
          _id: {
            createdBy: "$createdBy",
            target: { $ifNull: ["$courseId", "$materialId"] },
          },
          ids: { $push: "$_id" },
          count: { $sum: 1 },
        },
      },
      { $match: { "_id.target": { $ne: null }, count: { $gt: 1 } } },
    ])
    .toArray();

  for (const group of quizGroups) {
    const docs = await db
      .collection("personalquizzes")
      .find({ _id: { $in: group.ids } })
      .sort({ updatedAt: -1 })
      .toArray();

    const [kept, ...duplicates] = docs;
    logger.info(
      `[027] Merging ${duplicates.length} duplicates into PersonalQuiz ${kept._id} (User: ${group._id.createdBy})`,
    );

    const allLectures = [...(kept.lectures || [])];
    for (const dup of duplicates) {
      if (!dup.lectures) continue;

      for (const dupLec of dup.lectures) {
        let existingLec = allLectures.find((l) => l.title === dupLec.title);
        if (!existingLec) {
          allLectures.push(dupLec);
          continue;
        }

        // Merge topics within the same lecture
        for (const dupTopic of dupLec.topics) {
          let existingTopic = existingLec.topics.find(
            (t: any) => t.title === dupTopic.title,
          );
          if (!existingTopic) {
            existingLec.topics.push(dupTopic);
            continue;
          }

          // Merge question types within the same topic
          for (const dupQT of dupTopic.questionTypes) {
            let existingQT = existingTopic.questionTypes.find(
              (qt: any) => qt.type === dupQT.type,
            );
            if (!existingQT) {
              existingTopic.questionTypes.push(dupQT);
              continue;
            }

            // Union questions (prevent duplicate ObjectIds)
            const qIds = new Set(
              existingQT.questions.map((q: any) => q.toString()),
            );
            if (dupQT.questions) {
              dupQT.questions.forEach((q: any) => qIds.add(q.toString()));
            }
            existingQT.questions = Array.from(qIds).map(
              (id) => new Types.ObjectId(id as string),
            );
          }
        }
      }
    }

    await db.collection("personalquizzes").updateOne(
      { _id: kept._id },
      {
        $set: {
          lectures: allLectures,
          isDeleted: false,
        },
      },
    );

    await db
      .collection("personalquizzes")
      .deleteMany({ _id: { $in: duplicates.map((d) => d._id) } });
  }
  logger.info(
    `[027] PersonalQuiz merge completed for ${quizGroups.length} groups.`,
  );

  logger.info("[027] Migration complete.");
}
