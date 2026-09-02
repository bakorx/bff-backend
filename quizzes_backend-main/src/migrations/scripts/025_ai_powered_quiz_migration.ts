import { Mongoose, Types } from "mongoose";
import { ai, Z_FALLBACK_MODEL } from "@/ai/config";
import { Quiz, QuizQuestion, Question } from "@/learning/models";
// @ts-ignore
import { z } from "genkit";
import { logger } from "@/config";

/**
 * AI-powered migration to restructure legacy flat quizzes into the new hierarchical
 * Lecture -> Topic -> QuestionGroup schema.
 */

const NEW_TYPES = [
  "mcq",
  "true_false",
  "short_answer",
  "essay",
  "fill_in_blank",
] as const;
type NewType = (typeof NEW_TYPES)[number];

const TopicSchema = z.object({
  title: z
    .string()
    .describe("A descriptive title for this topic based on the questions."),
  description: z
    .string()
    .describe("A brief description of what these questions cover."),
});

async function enrichTopicWithAI(lectureName: string, sampleQuestions: any[]) {
  const prompt = `
    You are an academic content architect. I have a group of questions from a lecture titled "${lectureName}".
    Your task is to provide a more descriptive "Topic Title" and "Description" for this group.
    
    Sample questions from this group:
    ${sampleQuestions.map((q, i) => `Type: ${q.type}, Text: ${q.question}`).join("\n\n")}
    
    Return a JSON object:
    {
      "title": "A better descriptive title",
      "description": "Short description of these questions"
    }
  `;

  try {
    const { output } = await ai.generate({
      // @ts-ignore
      model: Z_FALLBACK_MODEL,
      prompt,
      output: { schema: TopicSchema },
    });

    if (!output) throw new Error("AI returned empty output");
    return output;
  } catch (err) {
    logger.error(`[025] AI Enrichment failed for ${lectureName}:`, err);
    return {
      title: "General",
      description: "Questions from " + lectureName,
    };
  }
}

function mapLegacyType(legacyType: string): NewType {
  const t = legacyType.toLowerCase();
  if (t === "fill-in" || t === "fill_in" || t === "fill_in_blank")
    return "fill_in_blank";
  if (t === "mcq" || t === "multiple_choice") return "mcq";
  if (t === "true_false" || t === "true-false") return "true_false";
  if (t === "short_answer" || t === "short-answer") return "short_answer";
  if (t === "essay") return "essay";
  return "mcq"; // Fallback
}

export async function up(mongoose: Mongoose) {
  logger.info("[025] Starting In-Place AI-powered quiz migration...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("[025] No database connection");

  // Use lowercase 'quizzes' as established by previous migration scripts (e.g., 006)
  const quizzesCol = db.collection("quizzes");
  const rawLegacyQuizzes = await quizzesCol.find({}).toArray();

  logger.info(
    `[025] Found ${rawLegacyQuizzes.length} documents in 'quizzes' to process.`,
  );

  let migratedCount = 0;
  let skippedCount = 0;

  for (const doc of rawLegacyQuizzes) {
    // Idempotency check: Does it already have the new 'lectures' field?
    if (doc.lectures && Array.isArray(doc.lectures)) {
      skippedCount++;
      continue;
    }

    logger.info(`[025] Migrating document ${doc._id} ("${doc.name}")...`);

    const lectures: any[] = [];
    let lectureOrder = 0;

    const legacyGroups = doc.quizQuestions || [];

    for (const legGroup of legacyGroups) {
      const questionIds = (legGroup.questions || []).map((q: any) =>
        q.toString(),
      );
      const allQuestionDocs = await Question.find({
        _id: { $in: questionIds },
      }).lean();

      if (allQuestionDocs.length === 0) continue;

      // Sample for AI metadata enrichment
      const sampleDocs = allQuestionDocs.slice(0, 5);
      const enriched = await enrichTopicWithAI(legGroup.name, sampleDocs);

      // Group questions by type
      const questionTypesMap = new Map<string, string[]>();
      for (const q of allQuestionDocs) {
        const type = mapLegacyType(q.type || "mcq");
        if (!questionTypesMap.has(type)) questionTypesMap.set(type, []);
        questionTypesMap.get(type)!.push(String(q._id));
      }

      lectures.push({
        lectureId: null, // Always null for privacy
        title: legGroup.name,
        description: "",
        order: lectureOrder++,
        topics: [
          {
            title: enriched.title,
            description: enriched.description,
            order: 0,
            questionTypes: Array.from(questionTypesMap.entries()).map(
              ([type, ids]) => ({
                type: type,
                questions: ids.map((id) => new Types.ObjectId(id)),
              }),
            ),
          },
        ],
      });
    }

    if (lectures.length === 0) {
      logger.info(
        `[025]   Skipping ${doc._id} - no valid questions/lectures found.`,
      );
      skippedCount++;
      continue;
    }

    // Determine createdBy from first question author if missing
    let creatorId = doc.createdBy;
    if (!creatorId && lectures[0]?.topics[0]?.questionTypes[0]?.questions[0]) {
      const q = await Question.findById(
        lectures[0].topics[0].questionTypes[0].questions[0],
      );
      creatorId = q?.author;
    }

    // Prepare the new document structure
    const updatedDoc = {
      ...doc,
      title: doc.name,
      materialId: null, // Always null for privacy
      status: doc.isApproved ? "published" : "draft",
      isAvailable: true,
      passingScore: 70,
      settings: {
        shuffleQuestions: true,
        showHints: true,
        showExplanations: true,
        allowRetakes: true,
        passingScore: 70,
      },
      lectures,
      // Remove legacy fields
      name: undefined,
      isApproved: undefined,
      quizQuestions: undefined,
      creditHours: undefined,
    };

    // Remove the undefined fields for MongoDB
    delete updatedDoc.name;
    delete updatedDoc.isApproved;
    delete updatedDoc.quizQuestions;
    delete updatedDoc.creditHours;

    // Perform the in-place replacement
    await quizzesCol.replaceOne({ _id: doc._id }, updatedDoc);

    migratedCount++;
    logger.info(`[025]   Successfully transformed ${doc._id}.`);
  }

  logger.info(`[025] In-place migration complete.`);
  logger.info(
    `[025] Processed: ${migratedCount}, Already Migrated/Skipped: ${skippedCount}`,
  );
}

export async function down(mongoose: Mongoose) {
  logger.info(
    "[025] Down migration requested. No destructive actions performed.",
  );
}
