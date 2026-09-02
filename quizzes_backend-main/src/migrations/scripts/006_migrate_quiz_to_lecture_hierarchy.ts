import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 006: Reshape IQuiz documents to the new lecture→topic→questionGroup hierarchy.
 *
 * OLD shape (quizzes collection):
 *   { title, description, courseCode (ObjectId), creator (ObjectId),
 *     questions: ObjectId[], isPublished: boolean, year: number,
 *     schoolId?, campusId?, accessLevel?, tags? }
 *
 * NEW shape (quizzes collection):
 *   { title, description, courseId (renamed from courseCode),
 *     deptId, schoolId, collegeId, campusId, universityId,
 *     approvalMeta: { status, ownerDeptId, ownerLineage, history },
 *     isAvailable, passingScore: 70,
 *     lectures: [ { title: "Imported Questions", order: 0,
 *                   topics: [ { title: "General", order: 0,
 *                               questionTypes: [ { type: "mcq", questions: [...] } ] } ] } ] }
 *
 * Strategy:
 *   1. Rename `courseCode` → `courseId`.
 *   2. Wrap the existing flat `questions` array into a single lecture/topic/questionGroup.
 *   3. Build a minimal `approvalMeta` from the old `isPublished` flag.
 *   4. Set `isAvailable = isPublished`.
 *   5. Unset stale fields: `courseCode`, `creator`, `isPublished`, `year`, `accessLevel`.
 *
 * Rollback: The original data is preserved in `questions` / `courseCode` until unset.
 * Re-run the migration after restoring a backup to fully revert.
 */
export async function up(mongoose: Mongoose) {
  logger.info("[006] Migrating Quiz documents to lecture hierarchy...");

  const db = mongoose.connection.db;
  if (!db) {
    logger.info("[006] No db object available. Ensure mongoose is connected.");
    return;
  }

  const quizzesCol = db.collection("quizzes");

  const cursor = quizzesCol.find({
    // Only process documents that still have the old flat shape
    $or: [{ courseCode: { $exists: true } }, { questions: { $exists: true } }],
  });

  let migrated = 0;
  let skipped = 0;

  for await (const doc of cursor) {
    // Skip if already migrated (has lectures field)
    if (doc.lectures && Array.isArray(doc.lectures)) {
      skipped++;
      continue;
    }

    const questionRefs: unknown[] = Array.isArray(doc.questions)
      ? doc.questions
      : [];
    const isPublished: boolean = doc.isPublished === true;

    // Group all questions into a single lecture → topic → questionGroup (type: mcq)
    const lectures =
      questionRefs.length > 0
        ? [
            {
              title: "Imported Questions",
              description: "Automatically migrated from flat question list.",
              order: 0,
              topics: [
                {
                  title: "General",
                  description: "",
                  order: 0,
                  questionTypes: [
                    {
                      type: "mcq",
                      questions: questionRefs,
                    },
                  ],
                },
              ],
            },
          ]
        : [];

    // Build a minimal approvalMeta
    const approvalMeta = {
      status: isPublished ? "published" : "draft",
      ownerDeptId: doc.schoolId ?? null,
      ownerLineage: {
        universityId: null,
        campusId: doc.campusId ?? null,
        collegeId: null,
        schoolId: doc.schoolId ?? null,
      },
      submittedBy: doc.creator ?? null,
      history: [],
    };

    const $set: Record<string, unknown> = {
      courseId: doc.courseCode ?? doc.courseId,
      lectures,
      approvalMeta,
      isAvailable: isPublished,
      passingScore: 70,
    };

    const $unset: Record<string, string> = {
      courseCode: "",
      creator: "",
      isPublished: "",
      year: "",
      accessLevel: "",
      questions: "",
    };

    await quizzesCol.updateOne({ _id: doc._id }, { $set, $unset });

    migrated++;
  }

  logger.info(
    `[006] Done. Migrated: ${migrated}, already up-to-date: ${skipped}.`,
  );
}
