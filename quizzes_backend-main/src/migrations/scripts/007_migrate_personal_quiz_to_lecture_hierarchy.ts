import { Mongoose, Types } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 007: Migrate PersonalQuiz inline question objects to IQuestion
 * documents and reshape into the new lecture→topic→questionGroup hierarchy.
 *
 * OLD shape (personalquizzes collection):
 *   { title, description, courseId, materialId (ObjectId),
 *     createdBy, questions: [{ question, options, answer, explanation,
 *                               type, difficulty, lectureNumber, hint }],
 *     settings, stats, isPublic, tags }
 *
 * NEW shape (personalquizzes collection):
 *   { title, description, courseId, createdBy,
 *     lectures: [ { title, order, topics: [ { title, order,
 *                   questionTypes: [ { type, questions: ObjectId[] } ] } ] } ],
 *     settings, stats, aiGenerationPlan?, isPublic, tags }
 *   (materialId removed — no longer in the interface)
 *
 * Strategy:
 *   1. For each PersonalQuiz with a legacy `questions` array:
 *      a. Group inline questions by their `type` field.
 *      b. For each type group, bulk-insert new IQuestion documents.
 *      c. Build a single lecture (title = "Imported") with a single topic
 *         ("General") containing one questionGroup per type.
 *   2. $set the new `lectures` field; $unset `questions` and `materialId`.
 *
 * NOTE: The inserted IQuestion documents use `isModerated = false` so staff
 * can review them. The `author` is set to the personalQuiz's `createdBy`.
 *
 * Rollback: Restore from a backup. Inserted IQuestion documents should be
 * deleted and the original `questions` / `materialId` fields restored.
 */
export async function up(mongoose: Mongoose) {
  logger.info(
    "[007] Migrating PersonalQuiz inline questions to IQuestion refs...",
  );

  const db = mongoose.connection.db;
  if (!db) {
    logger.info("[007] No db object available. Ensure mongoose is connected.");
    return;
  }

  const personalQuizzesCol = db.collection("personalquizzes");
  const questionsCol = db.collection("questions");

  const cursor = personalQuizzesCol.find({
    questions: { $exists: true, $not: { $size: 0 } },
    // Skip already migrated docs (have lectures field)
    lectures: { $exists: false },
  });

  let migrated = 0;
  let skipped = 0;

  for await (const doc of cursor) {
    if (doc.lectures && Array.isArray(doc.lectures)) {
      skipped++;
      continue;
    }

    const inlineQuestions: any[] = Array.isArray(doc.questions)
      ? doc.questions
      : [];
    if (inlineQuestions.length === 0) {
      // Nothing to migrate — just clean up stale fields
      await personalQuizzesCol.updateOne(
        { _id: doc._id },
        { $unset: { questions: "", materialId: "" }, $set: { lectures: [] } },
      );
      migrated++;
      continue;
    }

    // Map old `type` values to the new enum (mcq|true_false|short_answer|essay|fill_in_blank)
    const typeMap: Record<string, string> = {
      mcq: "mcq",
      "true-false": "true_false",
      "short-answer": "short_answer",
      essay: "essay",
      "fill-in": "fill_in_blank",
    };

    // Group inline questions by (normalised) type
    const byType: Record<string, any[]> = {};
    for (const q of inlineQuestions) {
      const normalised = typeMap[q.type] ?? "mcq";
      if (!byType[normalised]) byType[normalised] = [];
      byType[normalised].push(q);
    }

    const questionGroups: { type: string; questions: Types.ObjectId[] }[] = [];

    for (const [qType, items] of Object.entries(byType)) {
      // Build IQuestion documents
      const newDocs = items.map((q) => ({
        _id: new Types.ObjectId(),
        courseId: doc.courseId,
        question: q.question ?? "",
        options: Array.isArray(q.options) ? q.options : [],
        answer: q.answer ?? "",
        // IQuestion.type only supports "mcq" | "fill-in" | "true-false".
        // `short_answer` and `essay` from the old PersonalQuiz are mapped to
        // "fill-in" (closest open-text equivalent).  The original question
        // text is preserved verbatim so no semantic data is lost.
        type:
          qType === "true_false"
            ? "true-false"
            : qType === "fill_in_blank" ||
                qType === "short_answer" ||
                qType === "essay"
              ? "fill-in"
              : "mcq",
        explanation: q.explanation,
        lectureNumber: q.lectureNumber,
        hint: q.hint,
        author: doc.createdBy,
        isModerated: false,
        year: new Date().getFullYear(),
        aiGeneratedExplanation: "",
        aiConfidenceScore: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const insertResult = await questionsCol.insertMany(newDocs);
      const insertedIds = Object.values(
        insertResult.insertedIds,
      ) as Types.ObjectId[];
      questionGroups.push({ type: qType, questions: insertedIds });
    }

    const lectures = [
      {
        title: "Imported Questions",
        description: "Automatically migrated from inline question list.",
        order: 0,
        topics: [
          {
            title: "General",
            description: "",
            order: 0,
            questionTypes: questionGroups,
          },
        ],
      },
    ];

    await personalQuizzesCol.updateOne(
      { _id: doc._id },
      {
        $set: { lectures },
        $unset: { questions: "", materialId: "" },
      },
    );

    migrated++;
  }

  logger.info(
    `[007] Done. Migrated: ${migrated}, already up-to-date: ${skipped}.`,
  );
}
