import { Job, longQueue } from "../queues";
import { isValidObjectId } from "mongoose";
import {
  Material,
  Question,
  Quiz,
  FlashcardSet,
  services as materialServices,
  PersonalQuiz,
  LibraryMaterial,
  Course,
  MindMap,
} from "@/learning";
import { ai } from "@/ai";
import {
  FLOWS,
  MindMapContent,
  StudySession,
  StudyPlan,
  CourseSummary,
  buildSocketEmitter,
} from "@/app";
import { Types } from "mongoose";
import { PUBLISHERS, TRANSACTION_LOCKS } from "../utils";
import { z } from "genkit";
import { nanoid } from "nanoid";
import {
  stripOptionPrefix,
  stripQuestionTypePrefix,
  stripOptionPrefixes,
} from "@/utils";
import { publishers } from "@/socket";
import { redisConnection } from "@/config";
import { AiGenerateMindMapJobData } from "../interfaces";
import { logger } from "@/config";
import { emit as emitEvent } from "@/events/services";
import { flagForDelayedRec } from "@/recommendations/delayed-rec";

// -------------------------------------------------------------------------
// AI Handlers
// -------------------------------------------------------------------------

export function registerHandlers(): void {
  logger.info("[AI Handler] Registering AI queue handlers...");

  longQueue.register("ai:generate_flashcards", async (job: Job) => {
    const { materialId, courseId, userId, createdBy } = job.payload as {
      materialId: string;
      courseId: string;
      userId?: string;
      createdBy: string;
    };
    if (!isValidObjectId(materialId)) {
      logger.error(`[Worker] Invalid materialId: ${materialId}`);
      return;
    }
    if (courseId && !isValidObjectId(courseId)) {
      logger.error(`[Worker] Invalid courseId: ${courseId}`);
      return;
    }

    try {
      const material = await Material.findById(materialId);
      const filename =
        material?.originalName || material?.filename || "unknown";

      // Use zFlow in autonomous mode for agentic flashcard generation
      const result = await FLOWS.zFlow({
        userId: userId || createdBy,
        trigger: "autonomous_gen",
        isAutonomous: true,
        payload: {
          taskLabel: "Generate Flashcards",
          message: `Please generate a comprehensive set of flashcards for the material "${filename}" (ID: ${materialId}).`,
          materialId,
          courseId,
          userId: userId || createdBy,
        },
        emit: () => {}, // No need for live emission in background job
      });

      if (!result.success) {
        logger.error(
          `[Worker] zFlow failed for material ${materialId}: ${result.error}`,
        );
        throw new Error(result.error || "zFlow failed to generate flashcards");
      }
      // Persist the generated flashcard set to the main collection
      const flashcardArtifact = result.artifacts?.find(
        (a) => a.type === "flashcard_set",
      );
      if (flashcardArtifact && flashcardArtifact.content?.cards) {
        const material = await Material.findById(materialId);
        const cards = flashcardArtifact.content.cards;
        const filter: any = {
          createdBy: new Types.ObjectId(userId || createdBy),
          isDeleted: false,
        };
        if (courseId) {
          filter.courseId = new Types.ObjectId(courseId);
        } else {
          filter.materialId = new Types.ObjectId(materialId);
        }

        await FlashcardSet.findOneAndUpdate(
          filter,
          {
            $set: {
              materialId: new Types.ObjectId(materialId),
              courseId: courseId ? new Types.ObjectId(courseId) : undefined,
              title: flashcardArtifact.title || "Generated Flashcards",
              description:
                flashcardArtifact.description ||
                `Automatically generated from ${material?.originalName || "material"}`,
              cards: cards.map((c: any) => ({
                front: c.front,
                back: c.back,
                tags: c.tags || [],
              })),
              cardCount: cards.length,
              isDeleted: false,
            },
            $setOnInsert: { createdAt: new Date() },
          },
          { upsert: true, returnDocument: "after", runValidators: true },
        );
      } else {
        throw new Error(
          `No flashcard_set artifact found in zFlow output for material ${materialId}`,
        );
      }

      await Material.findByIdAndUpdate(materialId, {
        flashcardsGenerated: true,
        flashcardsGeneratedAt: new Date(),
      });

      await PUBLISHERS.publishAppEvent("ai:generate_flashcards:completed", {
        materialId,
        courseId,
        userId: userId || createdBy,
      });
    } catch (err: any) {
      await PUBLISHERS.publishAppEvent("ai:generate_flashcards:failed", {
        materialId,
        courseId,
        userId: userId || createdBy,
        reason: err?.message,
      });
      throw err;
    }
  });

  longQueue.register("ai:generate_personal_quiz", async (job: Job) => {
    const { materialId, courseId, userId, createdBy, settings } =
      job.payload as {
        materialId: string;
        courseId: string;
        userId?: string;
        createdBy: string;
        settings?: any;
      };

    if (!isValidObjectId(materialId)) {
      logger.error(`[Worker] Invalid materialId: ${materialId}`);
      return;
    }
    if (courseId && !isValidObjectId(courseId)) {
      logger.error(`[Worker] Invalid courseId: ${courseId}`);
      return;
    }

    const ownerId = userId || createdBy;

    try {
      // 1. Load material metadata
      const material = await Material.findById(materialId).lean();
      if (!material) throw new Error(`Material ${materialId} not found`);
      const materialTitle =
        (material as any).originalName ||
        (material as any).filename ||
        "Study Material";

      // 2. AI-powered search query generation — ask the model what to look for
      //    in this specific material before fetching content.
      const { output: queryPlan } = await ai.generate({
        system:
          "You are a study material analyst. Output ONLY a valid JSON object. No markdown, no extra text.",
        prompt:
          `You are preparing to generate a comprehensive quiz from a study material titled "${materialTitle}". ` +
          `Generate 6 targeted semantic search queries that will retrieve the most exam-relevant content ` +
          `from this material. Each query should target a distinct knowledge area (concepts, definitions, ` +
          `processes, formulas, applications, comparisons, exceptions). ` +
          `Return JSON: { "queries": ["query1", "query2", ...] }`,
        output: {
          format: "json",
          schema: z.object({ queries: z.array(z.string()).min(3).max(8) }),
        },
      });

      const searchQueries: string[] =
        queryPlan?.queries && queryPlan.queries.length > 0
          ? queryPlan.queries
          : [
              "main concepts and definitions",
              "key principles and theory",
              "examples applications and case studies",
              "processes formulas and procedures",
              "comparisons distinctions and exceptions",
              "important facts and terminology",
            ];

      // 3. Run all queries in parallel through semantic search
      const searchResults = await Promise.all(
        searchQueries.map((q) =>
          materialServices.search(undefined, q, 10, {
            materialIds: [materialId],
          }),
        ),
      );

      const seen = new Set<string>();
      const chunks = searchResults.flat().filter((c) => {
        if (seen.has(c.chunkId)) return false;
        seen.add(c.chunkId);
        return true;
      });

      if (chunks.length === 0) {
        throw new Error(
          `No content found for material ${materialId}. Ensure it has been processed.`,
        );
      }

      // Cap context to ~12 000 chars to keep input tokens reasonable and leave
      // headroom for the output. Each chunk is ~300 chars on average so this is
      // roughly 40 chunks worth of content — more than enough grounding.
      const MAX_CONTEXT_CHARS = 12_000;
      const materialContext = chunks
        .map((c, i) => `[${i + 1}] ${c.text}`)
        .join("\n\n")
        .slice(0, MAX_CONTEXT_CHARS);

      // 4. Step 1 — extract the lecture/topic structure from the material (no questions yet)
      const difficulty: string = settings?.difficulty || "medium";

      const { output: outlineOutput } = await ai.generate({
        system:
          "You are a study material analyst. Output ONLY a valid JSON object. No markdown, no extra text.",
        prompt:
          `Analyse the study material titled "${materialTitle}" and extract its full lecture and topic structure. ` +
          `Return every distinct lecture and topic covered so the list represents the complete scope of the material. ` +
          `Each lecture should have 1-4 topics.\n\n` +
          `STUDY MATERIAL:\n${materialContext}\n\nReturn raw JSON only.`,
        output: {
          format: "json",
          schema: z.object({
            quizTitle: z.string().optional(),
            lectures: z.array(
              z.object({
                title: z.string(),
                topics: z.array(z.object({ title: z.string() })),
              }),
            ),
          }),
        },
      });

      if (!outlineOutput?.lectures?.length) {
        throw new Error(
          "AI failed to extract a topic structure from the material",
        );
      }

      // 5. Step 2 — for every topic, fetch targeted chunks and generate questions in parallel

      // Credit guard: target 20–25 questions per lecture/section (not total).
      // Distribute evenly across the topics within each lecture (min 2 per topic).
      const QUESTIONS_PER_LECTURE = 22;

      const questionSchema = z.object({
        questionId: z.string().optional(),
        type: z.enum([
          "mcq",
          "true_false",
          "short_answer",
          "fill_in_blank",
          "essay",
        ]),
        difficulty: z.enum(["easy", "medium", "hard"]),
        text: z.string(),
        options: z.array(z.string()).default([]),
        correctAnswer: z.string(),
        explanation: z.string(),
        hint: z.string(),
      });

      const topicGenerationSchema = z.object({
        questions: z.array(questionSchema),
      });

      // Flatten to ordered jobs — lectureOrder/topicOrder are the source of truth
      // for sequence; we never rely on the AI or Promise.all completion order.
      const topicJobs: Array<{
        lectureTitle: string;
        lectureOrder: number;
        topicTitle: string;
        topicOrder: number;
        questionsPerTopic: number;
      }> = outlineOutput.lectures.flatMap((l: any, lIdx: number) => {
        const topicCount = Math.max(1, l.topics?.length ?? 1);
        const perTopic = Math.max(
          2,
          Math.ceil(QUESTIONS_PER_LECTURE / topicCount),
        );
        return l.topics.map((t: any, tIdx: number) => ({
          lectureTitle: l.title,
          lectureOrder: lIdx,
          topicTitle: t.title,
          topicOrder: tIdx,
          questionsPerTopic: perTopic,
        }));
      });

      const topicResults = await Promise.all(
        topicJobs.map(
          async ({
            lectureTitle,
            lectureOrder,
            topicTitle,
            topicOrder,
            questionsPerTopic,
          }) => {
            // Fetch chunks specific to this topic
            const topicChunks = await materialServices.search(
              undefined,
              `${topicTitle} ${lectureTitle}`,
              8,
              { materialIds: [materialId] },
            );

            const topicContext = topicChunks.length
              ? topicChunks.map((c, i) => `[${i + 1}] ${c.text}`).join("\n\n")
              : materialContext.slice(0, 4_000); // fallback if search returns nothing

            const { output: topicOutput } = await ai.generate({
              system:
                'You are a Quiz Generation Engine. Return ONLY a raw JSON object with a single key "questions" whose value is an array of question objects. ' +
                "Do NOT output a JSON schema or schema definition — output actual question data. No markdown, no backticks, no explanatory text.",
              prompt:
                `You are generating quiz questions for the topic "${topicTitle}" (part of "${lectureTitle}") ` +
                `from the study material below.\n\n` +
                `TARGET: Generate exactly ${questionsPerTopic} questions — no more, no fewer.\n\n` +
                `DIFFICULTY DISTRIBUTION:\n` +
                `- easy (basic recall & definitions): ~30%\n` +
                `- medium (application & understanding): ~40%\n` +
                `- hard (analysis, synthesis, critical thinking): ~30%\n\n` +
                `TYPE DISTRIBUTION — use all five types:\n` +
                `- mcq: ~40%\n` +
                `- short_answer: ~20%\n` +
                `- fill_in_blank: ~15%  (blank represented by ____; answer must be precise)\n` +
                `- true_false: ~15%  (correctAnswer must be exactly "true" or "false")\n` +
                `- essay: ~10%\n\n` +
                `MCQ FORMAT RULES:\n` +
                `Format 1 — Standard (use for ALL single-answer questions): clean question text, put answer choices in the "options" array, set "correctAnswer" to match the correct option text exactly.\n` +
                `  e.g. text="Which OSI layer handles routing?", options=["Network","Transport","Session","Application"], correctAnswer="Network"\n\n` +
                `Format 2 — Combination-answer only (use ONLY when the correct answer is a combination of multiple items, e.g. "AB", "ACD"): embed the individual items as A/B/C/D in the question text using <br> tags; set options to combination strings like ["AB","AC","BD","All of the above"]; set correctAnswer to the correct combo.\n` +
                `  e.g. text="Which of the following are valid?<br>A. Option one<br>B. Option two<br>C. Option three<br>D. Option four", options=["AB","BC","BD","All of the above"], correctAnswer="BD"\n` +
                `  ONLY use Format 2 when the question genuinely tests a multi-item combination. If there is a single correct answer, always use Format 1.\n\n` +
                `FOCUS ON:\n` +
                `- Core concepts and theories\n` +
                `- Key definitions\n` +
                `- Important processes and methods\n` +
                `- Real-world applications\n` +
                `- Critical relationships between concepts\n\n` +
                `STRICTLY AVOID:\n` +
                `- Course/department names, credit hours, lecturer information\n` +
                `- Administrative or formatting details from the material\n` +
                `- Duplicating question intent within this set\n\n` +
                `HTML FORMATTING — the frontend fully renders HTML, so use tags where appropriate:\n` +
                `- Line breaks: <br>\n` +
                `- Code snippets: <code>command</code>\n` +
                `- Emphasis: <strong>text</strong> or <em>text</em>\n` +
                `- Subscript / Superscript: <sub>x</sub> / <sup>2</sup>\n` +
                `- Lists: <ul><li>item</li></ul> or <ol><li>item</li></ol>\n\n` +
                `FIELD RULES:\n` +
                `- explanation: detailed reasoning for WHY the correct answer is correct\n` +
                `- hint: a short nudge that helps the student without giving away the answer\n` +
                `- Do NOT prefix question text with "Question X." or any numbering\n\n` +
                `- Do NOT prefix question text with its type label (e.g. "True or False:", "Fill in the Blank:", "Essay:", "Short Answer:")\n\n` +
                `- Do NOT prefix options with letters or numbering (e.g. "A.", "B)", "(C)", "1."). Options must be plain text only\n\n` +
                `STUDY MATERIAL:\n${topicContext}\n\nReturn raw JSON only.`,
              output: { format: "json", schema: topicGenerationSchema },
            });

            // Fallback: if the model returned a JSON-schema wrapper instead of data,
            // the actual questions end up in properties.questions.items (array form).
            const rawQuestions: any[] =
              topicOutput?.questions ??
              topicOutput?.properties?.questions?.items ??
              [];

            const questions = rawQuestions.map((q: any) => ({
              ...q,
              questionId: q.questionId || nanoid(),
            }));

            return {
              lectureTitle,
              lectureOrder,
              topicTitle,
              topicOrder,
              questions,
            };
          },
        ),
      );

      // Sort by the indices we assigned — order is now purely data-driven
      topicResults.sort(
        (a, b) =>
          a.lectureOrder - b.lectureOrder || a.topicOrder - b.topicOrder,
      );

      // Rebuild lectures structure in guaranteed order
      const lectureMap = new Map<number, { title: string; topics: any[] }>();
      for (const r of topicResults) {
        if (!lectureMap.has(r.lectureOrder)) {
          lectureMap.set(r.lectureOrder, { title: r.lectureTitle, topics: [] });
        }
        lectureMap.get(r.lectureOrder)!.topics.push({
          title: r.topicTitle,
          order: r.topicOrder,
          questions: r.questions,
        });
      }
      const lectures = Array.from(lectureMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([, l]) => ({
          ...l,
          topics: l.topics.sort((a: any, b: any) => a.order - b.order),
        }));

      const allQuestions: any[] = lectures.flatMap((l: any) =>
        l.topics.flatMap((t: any) => t.questions),
      );

      if (allQuestions.length === 0) {
        throw new Error("Quiz generation produced no questions");
      }

      // 6. Persist all questions to the global question bank (unmoderated)
      const savedQuestionsMap = new Map<string, Types.ObjectId>();
      for (const q of allQuestions) {
        const normalizedType =
          q.type === "true_false" || q.type === "true-false"
            ? "true_false"
            : q.type === "fill_in_blank" ||
                q.type === "fill-in-blank" ||
                q.type === "fill_in"
              ? "fill_in_blank"
              : q.type === "short_answer" || q.type === "short-answer"
                ? "short_answer"
                : q.type === "essay"
                  ? "essay"
                  : "mcq";

        const doc = await Question.create({
          courseId: courseId ? new Types.ObjectId(courseId) : undefined,
          question: stripQuestionTypePrefix(q.text),
          options: stripOptionPrefixes(
            q.options && q.options.length > 0 ? q.options : [],
          ),
          answer: stripOptionPrefix(q.correctAnswer) || "See explanation.",
          type: normalizedType,
          explanation: q.explanation || "N/A",
          hint: q.hint || "",
          author: new Types.ObjectId(ownerId),
          isModerated: false,
        });
        savedQuestionsMap.set(q.questionId, doc._id as Types.ObjectId);
      }

      // 7. Build PersonalQuiz lecture structure
      const buildTopicQuestionTypes = (qs: any[]) => {
        const byType: Record<string, Types.ObjectId[]> = {};
        for (const q of qs) {
          const id = savedQuestionsMap.get(q.questionId);
          if (id) {
            if (!byType[q.type]) byType[q.type] = [];
            byType[q.type].push(id);
          }
        }
        return Object.entries(byType).map(([type, qIds]) => ({
          type,
          questions: qIds,
        }));
      };

      const persistedLectures: any[] = lectures.map((l: any, lIdx: number) => ({
        lectureId: new Types.ObjectId(materialId),
        title: l.title || `Lecture ${lIdx + 1}`,
        description: "",
        order: lIdx,
        topics: l.topics.map((t: any, tIdx: number) => ({
          title: t.title || `Topic ${tIdx + 1}`,
          description: "",
          order: tIdx,
          questionTypes: buildTopicQuestionTypes(t.questions),
        })),
      }));

      // 7. Upsert the PersonalQuiz record
      const quizFilter: any = {
        createdBy: new Types.ObjectId(ownerId),
        isDeleted: false,
      };
      if (courseId) {
        quizFilter.courseId = new Types.ObjectId(courseId);
      } else {
        quizFilter.materialId = new Types.ObjectId(materialId);
      }

      await PersonalQuiz.findOneAndUpdate(
        quizFilter,
        {
          $set: {
            materialId: new Types.ObjectId(materialId),
            courseId: courseId ? new Types.ObjectId(courseId) : undefined,
            title: outlineOutput.quizTitle || `${materialTitle} — Quiz`,
            lectures: persistedLectures,
            settings: settings || {
              shuffleQuestions: true,
              showHints: true,
              showExplanations: true,
              allowRetakes: true,
              passingScore: 70,
            },
            isDeleted: false,
          },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true, returnDocument: "after", runValidators: true },
      );

      await Material.findByIdAndUpdate(materialId, {
        quizGenerated: true,
        quizGeneratedAt: new Date(),
      });

      await PUBLISHERS.publishAppEvent("ai:generate_personal_quiz:completed", {
        materialId,
        courseId,
        userId: ownerId,
      });
    } catch (err: any) {
      await PUBLISHERS.publishAppEvent("ai:generate_personal_quiz:failed", {
        materialId,
        courseId,
        userId: ownerId,
        reason: err?.message,
      });
      throw err;
    }
  });

  // AI: Public Quiz Generation (Admin-triggered, uses rich autonomous zFlow)
  longQueue.register("ai:public_quiz_generation", async (job: Job) => {
    const {
      courseId,
      materialId,
      materialTitle,
      numberOfQuestions = 40,
      generationId,
      createdBy,
    } = job.payload as {
      courseId: string;
      materialId: string;
      materialTitle: string;
      numberOfQuestions: number;
      generationId: string;
      createdBy: string;
    };

    const userId = createdBy;

    try {
      // Load material and course to ensure they exist
      const libraryMaterial = await LibraryMaterial.findById(materialId).lean();
      if (!libraryMaterial) throw new Error(`Material ${materialId} not found`);

      // Load the actual material file using the reference
      const material = await Material.findById(
        libraryMaterial.materialId,
      ).lean();
      if (!material)
        throw new Error(
          `Material file ${libraryMaterial.materialId} not found`,
        );

      const course = await Course.findById(courseId).lean();
      if (!course) throw new Error(`Course ${courseId} not found`);

      const filename =
        material.originalName || material.filename || materialTitle;
      const ownerId = userId || createdBy;
      const sourceMaterialId = String(material._id);

      // Emit material processing started
      await publishers.publicQuizGenerationMaterialStarted(
        userId,
        generationId,
        courseId,
        materialId,
        materialTitle,
      );

      // Short-circuit: if this is a pre-parsed question file, adapt directly
      if (
        (material as any).contentType === "questions" &&
        Array.isArray((material as any).parsedQuestions) &&
        (material as any).parsedQuestions.length > 0
      ) {
        const pqs: any[] = (material as any).parsedQuestions;

        await publishers.publicQuizGenerationStarted(userId, {
          generationId,
          courseId,
          courseCode: course.code,
          userId,
          totalLectures: 1,
          questionsPerLecture: pqs.length,
          startedAt: new Date(),
          stage: "outline_ready",
          message: `Detected pre-parsed question file with ${pqs.length} questions. Adapting to quiz schema.`,
        });

        const savedQuestionsMap = new Map<number, Types.ObjectId>();
        for (const [i, pq] of pqs.entries()) {
          const normalizedType =
            pq.type === "true_false" || pq.type === "true-false"
              ? "true_false"
              : pq.type === "fill_in_blank" || pq.type === "fill-in-blank"
                ? "fill_in_blank"
                : pq.type === "short_answer" || pq.type === "short-answer"
                  ? "short_answer"
                  : "mcq";

          const doc = await Question.create({
            courseId: courseId ? new Types.ObjectId(courseId) : undefined,
            question: pq.question,
            options: pq.options || [],
            answer: pq.answer || "See explanation.",
            type: normalizedType,
            explanation: pq.explanation || "",
            hint: pq.hint || "",
            author: new Types.ObjectId(ownerId),
            isModerated: false,
          });
          savedQuestionsMap.set(i, doc._id as Types.ObjectId);
        }

        const byType: Record<string, Types.ObjectId[]> = {};
        for (const [i, pq] of pqs.entries()) {
          const id = savedQuestionsMap.get(i);
          if (id) {
            if (!byType[pq.type]) byType[pq.type] = [];
            byType[pq.type].push(id);
          }
        }

        const persistedLectures = [
          {
            lectureId: new Types.ObjectId(sourceMaterialId),
            title: materialTitle,
            description: `Questions parsed directly from uploaded exam/question paper`,
            order: 0,
            topics: [
              {
                title: "All Questions",
                description: "",
                order: 0,
                questionTypes: Object.entries(byType).map(([type, qIds]) => ({
                  type,
                  questions: qIds,
                })),
              },
            ],
          },
        ];

        let quiz = await Quiz.findOne({
          createdBy: new Types.ObjectId(ownerId),
          courseId: new Types.ObjectId(courseId),
        });

        if (!quiz) {
          quiz = new Quiz({
            createdBy: new Types.ObjectId(ownerId),
            courseId: new Types.ObjectId(courseId),
            title: `${course.code} Quiz`,
            description: `Public quiz generated from course materials.`,
            lectures: [],
            settings: {
              shuffleQuestions: true,
              showHints: true,
              showExplanations: true,
            },
            tags: [],
            status: "draft",
            isAvailable: false,
            passingScore: 70,
          });
        }

        const existingLectures = quiz.lectures.filter(
          (l) => String(l.lectureId) !== sourceMaterialId,
        );

        const startOrder =
          existingLectures.length > 0
            ? Math.max(...existingLectures.map((l) => l.order)) + 1
            : 0;
        const adjustedLectures = persistedLectures.map((l) => ({
          ...l,
          order: l.order + startOrder,
        }));

        quiz.lectures = [...existingLectures, ...adjustedLectures] as any;
        quiz.tags = [
          ...new Set(
            [
              ...quiz.tags,
              course.code?.toLowerCase(),
              "exam-paper",
              "parsed-questions",
            ].filter(Boolean),
          ),
        ] as string[];

        await quiz.save();

        await Material.findByIdAndUpdate(sourceMaterialId, {
          quizGenerated: true,
          quizGeneratedAt: new Date(),
        });

        await LibraryMaterial.findByIdAndUpdate(materialId, {
          quizGenerated: true,
          quizGeneratedAt: new Date(),
        });

        await publishers.publicQuizGenerationMaterialCompleted(
          userId,
          generationId,
          courseId,
          materialId,
          materialTitle,
          String(quiz._id),
          pqs.length,
          1,
        );

        await publishers.publicQuizGenerationCompleted(userId, {
          generationId,
          courseId,
          courseCode: course.code,
          totalLectures: 1,
          totalQuestionsGenerated: pqs.length,
          totalJobsQueued: 1,
          completedAt: new Date(),
        });

        logger.info(
          `[Worker] Question-file quiz generation completed for material ${materialId}: quiz ${quiz._id} (${pqs.length} questions)`,
        );
        return;
      }

      const publicQuestionsPerLecture = Math.max(40, numberOfQuestions);

      // 1. AI-powered search query generation — ask the model what to look for
      //    in this specific material before fetching content.
      const { output: queryPlan } = await ai.generate({
        system:
          "You are a study material analyst. Output ONLY a valid JSON object. No markdown, no extra text.",
        prompt:
          `You are preparing to generate a comprehensive public quiz from a study material titled "${filename}". ` +
          `Generate 6 targeted semantic search queries that will retrieve the most exam-relevant content ` +
          `from this material. Each query should target a distinct knowledge area (concepts, definitions, ` +
          `processes, formulas, applications, comparisons, exceptions). ` +
          `Return JSON: { "queries": ["query1", "query2", ...] }`,
        output: {
          format: "json",
          schema: z.object({ queries: z.array(z.string()).min(3).max(8) }),
        },
      });

      const searchQueries: string[] =
        queryPlan?.queries && queryPlan.queries.length > 0
          ? queryPlan.queries
          : [
              "main concepts and definitions",
              "key principles and theory",
              "examples applications and case studies",
              "processes formulas and procedures",
              "comparisons distinctions and exceptions",
              "important facts and terminology",
            ];

      // 2. Run all queries in parallel through semantic search
      const searchResults = await Promise.all(
        searchQueries.map((q) =>
          materialServices.search(undefined, q, 10, {
            materialIds: [sourceMaterialId],
          }),
        ),
      );

      const seen = new Set<string>();
      const chunks = searchResults.flat().filter((c) => {
        if (seen.has(c.chunkId)) return false;
        seen.add(c.chunkId);
        return true;
      });

      if (chunks.length === 0) {
        throw new Error(
          `No content found for material ${materialId}. Ensure it has been processed.`,
        );
      }

      const MAX_CONTEXT_CHARS = 12_000;
      const materialContext = chunks
        .map((c, i) => `[${i + 1}] ${c.text}`)
        .join("\n\n")
        .slice(0, MAX_CONTEXT_CHARS);

      // 3. Extract the lecture/topic structure from the material.
      const { output: outlineOutput } = await ai.generate({
        system:
          "You are a study material analyst. Output ONLY a valid JSON object. No markdown, no extra text.",
        prompt:
          `Analyse the study material titled "${filename}" and extract its full lecture and topic structure. ` +
          `Return every distinct lecture and topic covered so the list represents the complete scope of the material. ` +
          `Each lecture should have 1-4 topics. This is for a public quiz, so prioritize broad, testable coverage.` +
          `\n\nSTUDY MATERIAL:\n${materialContext}\n\nReturn raw JSON only.`,
        output: {
          format: "json",
          schema: z.object({
            quizTitle: z.string().optional(),
            lectures: z.array(
              z.object({
                title: z.string(),
                topics: z.array(z.object({ title: z.string() })),
              }),
            ),
          }),
        },
      });

      if (!outlineOutput?.lectures?.length) {
        throw new Error(
          "AI failed to extract a topic structure from the material",
        );
      }

      await publishers.publicQuizGenerationStarted(userId, {
        generationId,
        courseId,
        courseCode: course.code,
        userId,
        totalLectures: outlineOutput.lectures.length,
        questionsPerLecture: publicQuestionsPerLecture,
        startedAt: new Date(),
        stage: "outline_ready",
        message: `Topic outline extracted for ${outlineOutput.lectures.length} lecture sections. Starting parallel generation.`,
      });

      const questionSchema = z.object({
        questionId: z.string().optional(),
        type: z.enum([
          "mcq",
          "true_false",
          "short_answer",
          "fill_in_blank",
          "essay",
        ]),
        difficulty: z.enum(["easy", "medium", "hard"]),
        text: z.string(),
        options: z.array(z.string()).default([]),
        correctAnswer: z.string(),
        explanation: z.string(),
        hint: z.string(),
      });

      const topicGenerationSchema = z.object({
        questions: z.array(questionSchema),
      });

      const buildPublicQuestionMix = (total: number) => {
        const mcq = Math.max(1, Math.round(total * 0.65));
        const trueFalse = Math.max(1, Math.round(total * 0.2));
        const fillInBlank = Math.max(1, Math.round(total * 0.1));
        const shortAnswer = Math.max(1, total - mcq - trueFalse - fillInBlank);
        return {
          mcq,
          trueFalse,
          fillInBlank,
          shortAnswer,
        };
      };

      // 4. For every topic, fetch targeted chunks and generate questions in parallel.
      const topicJobs: Array<{
        lectureTitle: string;
        lectureOrder: number;
        topicTitle: string;
        topicOrder: number;
        questionsPerTopic: number;
      }> = outlineOutput.lectures.flatMap((l: any, lIdx: number) => {
        const topicCount = Math.max(1, l.topics?.length ?? 1);
        const perTopic = Math.max(
          2,
          Math.ceil(publicQuestionsPerLecture / topicCount),
        );
        return l.topics.map((t: any, tIdx: number) => ({
          lectureTitle: l.title,
          lectureOrder: lIdx,
          topicTitle: t.title,
          topicOrder: tIdx,
          questionsPerTopic: perTopic,
        }));
      });

      const totalTopicsByLecture = new Map<number, number>();
      for (const job of topicJobs) {
        totalTopicsByLecture.set(
          job.lectureOrder,
          (totalTopicsByLecture.get(job.lectureOrder) || 0) + 1,
        );
      }

      const completedTopicsByLecture = new Map<number, number>();
      const lectureQuestionTotals = new Map<number, number>();
      const completedLectures = new Set<number>();
      let completedTopics = 0;

      for (const [index, lecture] of outlineOutput.lectures.entries()) {
        await publishers.publicQuizGenerationLectureStarted(userId, {
          generationId,
          courseId,
          lectureTitle: lecture.title,
          lectureIndex: index,
          totalLectures: outlineOutput.lectures.length,
          stage: "lecture_discovered",
          message: `Lecture outline discovered: ${lecture.title}. Parallel topic agents are starting.`,
        });
      }

      const topicResults = await Promise.all(
        topicJobs.map(
          async ({
            lectureTitle,
            lectureOrder,
            topicTitle,
            topicOrder,
            questionsPerTopic,
          }) => {
            await publishers.publicQuizGenerationProgress(userId, {
              generationId,
              courseId,
              completedLectures: 0,
              totalLectures: outlineOutput.lectures.length,
              currentLecture: lectureTitle,
              currentTopic: topicTitle,
              completedTopics: 0,
              totalTopics: topicJobs.length,
              percentComplete: 0,
              stage: "topic_generation_started",
              message: `Parallel agent started for ${lectureTitle} → ${topicTitle}.`,
            });

            const topicChunks = await materialServices.search(
              undefined,
              `${topicTitle} ${lectureTitle}`,
              8,
              { materialIds: [sourceMaterialId] },
            );

            const topicContext = topicChunks.length
              ? topicChunks.map((c, i) => `[${i + 1}] ${c.text}`).join("\n\n")
              : materialContext.slice(0, 4_000);

            const mix = buildPublicQuestionMix(questionsPerTopic);

            const { output: topicOutput } = await ai.generate({
              system:
                'You are a Quiz Generation Engine. Return ONLY a raw JSON object with a single key "questions" whose value is an array of question objects. ' +
                "Do NOT output a JSON schema or schema definition — output actual question data. No markdown, no backticks, no explanatory text.",
              prompt:
                `You are generating public quiz questions for the topic "${topicTitle}" (part of "${lectureTitle}") ` +
                `from the study material below.\n\n` +
                `TARGET: Generate exactly ${questionsPerTopic} questions — no more, no fewer.\n\n` +
                `PUBLIC QUIZ DISTRIBUTION:\n` +
                `- mcq: ${mix.mcq}\n` +
                `- true_false: ${mix.trueFalse}\n` +
                `- fill_in_blank: ${mix.fillInBlank}\n` +
                `- short_answer: ${mix.shortAnswer}\n` +
                `- essay: 0 unless absolutely necessary\n\n` +
                `DIFFICULTY DISTRIBUTION:\n` +
                `- easy (basic recall & definitions): ~30%\n` +
                `- medium (application & understanding): ~40%\n` +
                `- hard (analysis, synthesis, critical thinking): ~30%\n\n` +
                `MCQ FORMAT RULES:\n` +
                `Format 1 — Standard (use for ALL single-answer questions): clean question text, put answer choices in the "options" array, set "correctAnswer" to match the correct option text exactly.\n` +
                `  e.g. text="Which OSI layer handles routing?", options=["Network","Transport","Session","Application"], correctAnswer="Network"\n\n` +
                `Format 2 — Combination-answer only (use ONLY when the correct answer is a combination of multiple items, e.g. "AB", "ACD"): embed the individual items as A/B/C/D in the question text using <br> tags; set options to combination strings like ["AB","AC","BD","All of the above"]; set correctAnswer to the correct combo.\n` +
                `  e.g. text="Which of the following are valid?<br>A. Option one<br>B. Option two<br>C. Option three<br>D. Option four", options=["AB","BC","BD","All of the above"], correctAnswer="BD"\n` +
                `  ONLY use Format 2 when the question genuinely tests a multi-item combination. If there is a single correct answer, always use Format 1.\n\n` +
                `FOCUS ON:\n` +
                `- Core concepts and theories\n` +
                `- Key definitions\n` +
                `- Important processes and methods\n` +
                `- Real-world applications\n` +
                `- Critical relationships between concepts\n\n` +
                `FIELD RULES:\n` +
                `- explanation: detailed reasoning for WHY the correct answer is correct\n` +
                `- hint: a short nudge that helps the student without giving away the answer\n` +
                `- Do NOT prefix question text with "Question X." or any numbering\n\n` +
                `- Do NOT prefix question text with its type label (e.g. "True or False:", "Fill in the Blank:", "Essay:", "Short Answer:")\n\n` +
                `- Do NOT prefix options with letters or numbering (e.g. "A.", "B)", "(C)", "1."). Options must be plain text only\n\n` +
                `STUDY MATERIAL:\n${topicContext}\n\nReturn raw JSON only.`,
              output: { format: "json", schema: topicGenerationSchema },
            });

            const rawQuestions: any[] =
              topicOutput?.questions ??
              topicOutput?.properties?.questions?.items ??
              [];

            const questions = rawQuestions.map((q: any) => ({
              ...q,
              questionId: q.questionId || nanoid(),
            }));

            lectureQuestionTotals.set(
              lectureOrder,
              (lectureQuestionTotals.get(lectureOrder) || 0) + questions.length,
            );

            completedTopics += 1;
            const lectureCompletedTopics =
              (completedTopicsByLecture.get(lectureOrder) || 0) + 1;
            completedTopicsByLecture.set(lectureOrder, lectureCompletedTopics);

            const percentComplete = Math.min(
              99,
              Math.round((completedTopics / topicJobs.length) * 100),
            );

            await publishers.publicQuizGenerationProgress(userId, {
              generationId,
              courseId,
              completedLectures: completedLectures.size,
              totalLectures: outlineOutput.lectures.length,
              currentLecture: lectureTitle,
              currentTopic: topicTitle,
              completedTopics,
              totalTopics: topicJobs.length,
              percentComplete,
              stage: "topic_generation_completed",
              message: `Parallel agent completed ${lectureTitle} → ${topicTitle} with ${questions.length} questions.`,
            });

            if (
              lectureCompletedTopics ===
                (totalTopicsByLecture.get(lectureOrder) || 0) &&
              !completedLectures.has(lectureOrder)
            ) {
              completedLectures.add(lectureOrder);
              await publishers.publicQuizGenerationLectureCompleted(userId, {
                generationId,
                courseId,
                lectureTitle,
                lectureIndex: lectureOrder,
                totalLectures: outlineOutput.lectures.length,
                questionsGenerated:
                  lectureQuestionTotals.get(lectureOrder) || 0,
                completedLectures: completedLectures.size,
                percentComplete,
                stage: "lecture_assembled",
                message: `Lecture ${lectureTitle} assembled from its parallel topic agents.`,
              });
            }

            return {
              lectureTitle,
              lectureOrder,
              topicTitle,
              topicOrder,
              questions,
            };
          },
        ),
      );

      topicResults.sort(
        (a, b) =>
          a.lectureOrder - b.lectureOrder || a.topicOrder - b.topicOrder,
      );

      const lectureMap = new Map<number, { title: string; topics: any[] }>();
      for (const r of topicResults) {
        if (!lectureMap.has(r.lectureOrder)) {
          lectureMap.set(r.lectureOrder, { title: r.lectureTitle, topics: [] });
        }
        lectureMap.get(r.lectureOrder)!.topics.push({
          title: r.topicTitle,
          order: r.topicOrder,
          questions: r.questions,
        });
      }
      const lectures = Array.from(lectureMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([, l]) => ({
          ...l,
          topics: l.topics.sort((a: any, b: any) => a.order - b.order),
        }));

      await publishers.publicQuizGenerationProgress(userId, {
        generationId,
        courseId,
        completedLectures: completedLectures.size,
        totalLectures: outlineOutput.lectures.length,
        percentComplete: 100,
        stage: "lectures_assembled",
        message: `Lecture structure assembled from parallel topic agents. Persisting quiz now.`,
      });

      const allQuestions: any[] = lectures.flatMap((l: any) =>
        l.topics.flatMap((t: any) => t.questions),
      );

      if (allQuestions.length === 0) {
        throw new Error("Public quiz generation produced no questions");
      }

      const { output: tagOutput } = await ai.generate({
        system:
          "You are a course tagging engine. Output ONLY a valid JSON object. No markdown, no extra text.",
        prompt:
          `Generate concise semantic tags for a public quiz built from the material titled "${filename}". ` +
          `Use the course code "${course.code}" and the lecture/topic outline below to infer the most relevant study tags. ` +
          `Return 5 to 10 short lowercase tags that reflect the subject matter, topics, and exam focus. ` +
          `Avoid generic tags like 'quiz' or 'test' unless paired with a subject keyword. ` +
          `Prefer simple hyphenated tags when needed. ` +
          `Return JSON: { "tags": ["tag-one", "tag-two", ...] }\n\n` +
          `LECTURE OUTLINE:\n${JSON.stringify(outlineOutput.lectures, null, 2)}\n\n` +
          `QUESTION SAMPLE COUNT: ${allQuestions.length}`,
        output: {
          format: "json",
          schema: z.object({
            tags: z.array(z.string()).min(5).max(10),
          }),
        },
      });

      const aiTags =
        tagOutput?.tags?.filter((tag: string) => tag.trim().length > 0) || [];

      const savedQuestionsMap = new Map<string, Types.ObjectId>();
      for (const q of allQuestions) {
        const normalizedType =
          q.type === "true_false" || q.type === "true-false"
            ? "true_false"
            : q.type === "fill_in_blank" ||
                q.type === "fill-in-blank" ||
                q.type === "fill_in"
              ? "fill_in_blank"
              : q.type === "short_answer" || q.type === "short-answer"
                ? "short_answer"
                : q.type === "essay"
                  ? "essay"
                  : "mcq";

        const doc = await Question.create({
          courseId: courseId ? new Types.ObjectId(courseId) : undefined,
          question: stripQuestionTypePrefix(q.text),
          options: stripOptionPrefixes(
            q.options && q.options.length > 0 ? q.options : [],
          ),
          answer: stripOptionPrefix(q.correctAnswer) || "See explanation.",
          type: normalizedType,
          explanation: q.explanation || "N/A",
          hint: q.hint || "",
          author: new Types.ObjectId(ownerId),
          isModerated: false,
        });
        savedQuestionsMap.set(q.questionId, doc._id as Types.ObjectId);
      }

      const buildTopicQuestionTypes = (qs: any[]) => {
        const byType: Record<string, Types.ObjectId[]> = {};
        for (const q of qs) {
          const id = savedQuestionsMap.get(q.questionId);
          if (id) {
            if (!byType[q.type]) byType[q.type] = [];
            byType[q.type].push(id);
          }
        }
        return Object.entries(byType).map(([type, qIds]) => ({
          type,
          questions: qIds,
        }));
      };

      const persistedLectures: any[] = lectures.map((l: any, lIdx: number) => ({
        lectureId: new Types.ObjectId(sourceMaterialId),
        title: l.title || `Lecture ${lIdx + 1}`,
        description: `AI-generated public quiz coverage for ${filename}`,
        order: lIdx,
        topics: l.topics.map((t: any, tIdx: number) => ({
          title: t.title || `Topic ${tIdx + 1}`,
          description: "",
          order: tIdx,
          questionTypes: buildTopicQuestionTypes(t.questions),
        })),
      }));

      let quiz = await Quiz.findOne({
        createdBy: new Types.ObjectId(ownerId),
        courseId: new Types.ObjectId(courseId),
      });

      if (!quiz) {
        quiz = new Quiz({
          createdBy: new Types.ObjectId(ownerId),
          courseId: new Types.ObjectId(courseId),
          title: `${course.code} Quiz`,
          description: `AI-generated comprehensive public quiz.`,
          lectures: [],
          settings: {
            shuffleQuestions: true,
            showHints: true,
            showExplanations: true,
          },
          tags: [],
          status: "draft",
          isAvailable: false,
          passingScore: 70,
        });
      }

      const existingLectures = quiz.lectures.filter(
        (l) => String(l.lectureId) !== sourceMaterialId,
      );

      const startOrder =
        existingLectures.length > 0
          ? Math.max(...existingLectures.map((l) => l.order)) + 1
          : 0;
      const adjustedLectures = persistedLectures.map((l) => ({
        ...l,
        order: l.order + startOrder,
      }));

      quiz.lectures = [...existingLectures, ...adjustedLectures] as any;
      quiz.tags = [...new Set([...quiz.tags, ...aiTags])] as string[];

      await quiz.save();

      await Material.findByIdAndUpdate(sourceMaterialId, {
        quizGenerated: true,
        quizGeneratedAt: new Date(),
      });

      await LibraryMaterial.findByIdAndUpdate(materialId, {
        quizGenerated: true,
        quizGeneratedAt: new Date(),
      });

      // Emit material processing completed
      await publishers.publicQuizGenerationMaterialCompleted(
        userId,
        generationId,
        courseId,
        materialId,
        materialTitle,
        String(quiz._id),
        allQuestions.length,
        lectures.length,
      );

      await publishers.publicQuizGenerationCompleted(userId, {
        generationId,
        courseId,
        courseCode: course.code,
        totalLectures: lectures.length,
        totalQuestionsGenerated: allQuestions.length,
        totalJobsQueued: topicJobs.length,
        completedAt: new Date(),
      });

      logger.info(
        `[Worker] Public quiz generation completed for material ${materialId}: quiz ${quiz._id}`,
      );
    } catch (err: any) {
      logger.error(
        `[Worker] Public quiz generation failed for material ${materialId}:`,
        err?.message,
      );
      // Emit failure event
      await publishers.publicQuizGenerationMaterialFailed(
        userId,
        generationId,
        courseId,
        materialId,
        materialTitle,
        err?.message || "Generation failed",
      );
      throw err;
    }
  });

  // AI: Grade free-text quiz answers with Z
  longQueue.register("ai:grade_quiz_answers", async (job: Job) => {
    const { quizId, userId, answers, jobId } = job.payload as {
      quizId: string;
      userId: string;
      jobId: string;
      answers: {
        questionId: string;
        question: string;
        answer: string;
        correctAnswer?: string;
      }[];
    };

    try {
      const gradingPrompt = answers
        .map(
          (a, i) =>
            `Q${i + 1} (ID: ${a.questionId})\n` +
            `Question: ${a.question}\n` +
            `Student Answer: ${a.answer || "(no answer)"}` +
            (a.correctAnswer ? `\nReference Answer: ${a.correctAnswer}` : ""),
        )
        .join("\n---\n");

      const response = await ai.generate({
        // userId lets the model router resolve the caller's tier — paid
        // subscribers get paid models for grading instead of the free chain.
        userId,
        messages: [
          {
            role: "user",
            content: [
              {
                text: `Grade the following student answers:\n\n${gradingPrompt}`,
              },
            ],
          },
        ],
        system: `You are Z, an academic AI grader on the Qz platform.
Grade each student answer fairly, considering partial credit and synonymous phrasing.
Return ONLY valid JSON, no extra text:
{"results":[{"questionId":"...","score":0-100,"isCorrect":true/false,"feedback":"1-2 sentence constructive feedback"}]}
isCorrect = score >= 70.`,
        config: { temperature: 0.2, maxOutputTokens: 2000 },
      });

      const text =
        response?.message?.content?.[0]?.text || response?.text || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in Z grading response");

      const { results } = JSON.parse(jsonMatch[0]) as {
        results: {
          questionId: string;
          score: number;
          isCorrect: boolean;
          feedback: string;
        }[];
      };

      // Update quiz stats (personal quiz first, fall back to system quiz)
      if (quizId) {
        const correct = results.filter((r) => r.isCorrect).length;
        const pct = Math.round((correct / results.length) * 100);
        const statsUpdate = {
          $inc: { "stats.totalAttempts": 1 },
          $set: { "stats.lastAttempted": new Date() },
          $max: { "stats.bestScore": pct },
        };
        const updated = await PersonalQuiz.findByIdAndUpdate(
          quizId,
          statsUpdate,
        );
        if (!updated) {
          await Quiz.findByIdAndUpdate(quizId, statsUpdate);
          // No quiz:public_graded emit here — this fallback branch is dead
          // in practice (ai:grade_quiz_answers is only ever enqueued with a
          // PersonalQuiz id today), and the taxonomy has no distinct
          // event for it becoming reachable without a real caller.
        } else {
          const gradedEvent = emitEvent(
            "quiz:private_graded",
            userId,
            { type: "personal_quiz", id: quizId },
            { score: pct, correctCount: correct, totalCount: results.length },
          );

          // §11 "24h-after-flag cron": quiz fail auto-flags a delayed
          // system-tier rec. Threshold matches rule-engine.ts's own
          // quiz-fail rule (score < 70) for consistency.
          if (pct < 70) {
            gradedEvent.then((event) => {
              if (event) {
                flagForDelayedRec(userId, "dashboard", event._id);
              }
            });
          }
        }
      }

      // Store result in Redis for polling (TTL: 10 minutes)
      const key = `quiz:grade:result:${jobId}`;
      await redisConnection.set(key, JSON.stringify({ results }), "EX", 600);

      await PUBLISHERS.publishAppEvent("ai:grade_quiz_answers:completed", {
        quizId,
        userId,
        jobId,
      });
    } catch (err: any) {
      const key = `quiz:grade:result:${jobId}`;
      await redisConnection.set(
        key,
        JSON.stringify({ error: err?.message || "Grading failed" }),
        "EX",
        600,
      );
      await PUBLISHERS.publishAppEvent("ai:grade_quiz_answers:failed", {
        quizId,
        userId,
        jobId,
        reason: err?.message,
      });
      throw err;
    }
  });

  longQueue.register("ai:generate_mindmap", async (job: Job) => {
    const { materialId, courseId, userId, createdBy, settings } =
      job.payload as unknown as AiGenerateMindMapJobData;

    try {
      // Use zFlow in autonomous mode for agentic mindmap generation
      const result = await FLOWS.zFlow({
        userId: userId || createdBy,
        trigger: "autonomous_gen",
        isAutonomous: true,
        payload: {
          taskLabel: "Generate Mind Map",
          message: `Please generate a comprehensive hierarchical mind map for the material with ID ${materialId}. Include core concepts, subtopics, and key details.`,
          materialId,
          courseId,
          settings,
          userId: userId || createdBy,
        },
        emit: () => {},
      });

      if (!result.success) {
        throw new Error(result.error || "zFlow failed to generate mindmap");
      }

      const mindmapArtifact = result.artifacts?.find(
        (a) => a.type === "mindmap",
      );
      if (!mindmapArtifact) {
        throw new Error(
          `No mindmap artifact found in zFlow output for material ${materialId}`,
        );
      }

      const content = mindmapArtifact.content as MindMapContent;

      // Persist to standalone MindMap model for library visibility
      const mindmap = await MindMap.create({
        userId: userId || createdBy,
        title: mindmapArtifact.title || "Generated Mind Map",
        courseId,
        sourceSessionId: result.sessionId,
        sourceArtifactId: mindmapArtifact.artifactId,
        nodes: content.nodes,
        edges: content.edges,
      });

      await PUBLISHERS.publishAppEvent("ai:generate_mindmap:completed", {
        materialId,
        courseId,
        userId: userId || createdBy,
        artifactId: mindmapArtifact.artifactId,
        mindmapId: mindmap._id,
      });
    } catch (err: any) {
      await PUBLISHERS.publishAppEvent("ai:generate_mindmap:failed", {
        materialId,
        courseId,
        userId: userId || createdBy,
        reason: err?.message,
      });
      throw err;
    }
  });

  longQueue.register("app:session:trigger", async (job: Job) => {
    const { sessionId, userId, trigger, payload } = job.payload as {
      sessionId: string;
      userId: string;
      trigger: string;
      payload: any;
    };
    const lockToken = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

    if (!isValidObjectId(sessionId)) {
      logger.info(`[handlers:sessionTriggers] Invalid sessionId: ${sessionId}`);
      return;
    }

    const lockAcquired = await TRANSACTION_LOCKS.acquireSessionTriggerLock(
      sessionId,
      lockToken,
    );
    if (!lockAcquired) {
      throw new Error(
        `[handlers:sessionTriggers] Session ${sessionId} is already being processed`,
      );
    }

    try {
      const session = await StudySession.findById(sessionId).lean();
      if (!session) {
        logger.info(
          `[handlers:sessionTriggers] Session not found: ${sessionId}`,
        );
        return;
      }

      const emit = buildSocketEmitter(sessionId, userId);

      if (session.mode === "free") {
        const result = await FLOWS.freeFlow({
          sessionId,
          userId,
          message: payload?.message || "",
          userMessageId: payload?.messageId
            ? String(payload.messageId)
            : undefined,
          emit,
        });

        if (!result.success) {
          const errorMessage = result.error || "freeFlow failed";
          const isTransientWriteConflict =
            errorMessage.includes("Write conflict") ||
            errorMessage.includes("TransientTransactionError");

          if (isTransientWriteConflict) {
            throw new Error(errorMessage);
          }
        }
      } else {
        const result = await FLOWS.zFlow({
          sessionId,
          userId,
          trigger: trigger as any,
          payload,
          emit: (signal) => {
            emit(signal);
          },
        });

        if (!result.success) {
          const errorMessage = result.error || "zFlow failed";
          const isTransientWriteConflict =
            errorMessage.includes("Write conflict") ||
            errorMessage.includes("TransientTransactionError");

          if (isTransientWriteConflict) {
            throw new Error(errorMessage);
          }
        }
      }
    } catch (err: any) {
      logger.error(
        `[handlers:sessionTriggers] Error processing trigger: ${err.message}`,
      );
      throw err; // Re-throw so BullMQ can attempt retries if configured
    } finally {
      try {
        await TRANSACTION_LOCKS.releaseSessionTriggerLock(sessionId, lockToken);
      } catch (unlockErr: any) {
        logger.error(
          `[handlers:sessionTriggers] Failed to release session lock for ${sessionId}: ${unlockErr?.message || unlockErr}`,
        );
      }
    }
  });

  // AI: Generate study plan via transient zFlow session
  longQueue.register("ai:generate_study_plan", async (job: Job) => {
    const { sessionId, userId, goal, materialIds, courseId } = job.payload as {
      sessionId: string;
      userId: string;
      goal?: string;
      materialIds: string[];
      courseId?: string;
    };
    if (!isValidObjectId(sessionId)) {
      logger.error(
        `[handlers:studyPlanGenerate] Invalid sessionId: ${sessionId}`,
      );
      return;
    }
    try {
      const result = await FLOWS.zFlow({
        userId,
        trigger: "autonomous_gen",
        isAutonomous: true,
        payload: {
          taskLabel: "Generate Study Plan",
          message: `Please generate a comprehensive, structured study plan for the session "${sessionId}".${goal ? ` The student's goal is: "${goal}".` : ""} Use the search_materials tool to read all available materials, then call generate_study_plan to create the plan.`,
          sourceSessionId: sessionId,
          materialIds,
          courseId,
          userId,
        },
        emit: () => {},
      });

      if (!result.success) {
        throw new Error(result.error || "zFlow failed to generate study plan");
      }

      // Retrieve the generated or updated study plan
      let studyPlanDoc = await StudyPlan.findOne({
        sessionId: new Types.ObjectId(sessionId),
      });

      // Fallback: check if study_plan artifact exists in zFlow result
      if (!studyPlanDoc) {
        const planArtifact = result.artifacts?.find(
          (a) => a.type === "study_plan",
        );
        if (planArtifact && planArtifact.content) {
          const planContent = planArtifact.content as any;
          studyPlanDoc = await StudyPlan.findOneAndUpdate(
            { sessionId: new Types.ObjectId(sessionId) },
            {
              $set: {
                sessionId: new Types.ObjectId(sessionId),
                userId: new Types.ObjectId(userId),
                courseId: courseId ? new Types.ObjectId(courseId) : undefined,
                goal: planContent.goal || goal || "Master course materials",
                chapters: planContent.chapters || [],
                totalChapters: (planContent.chapters || []).length,
                totalBlocks: planContent.totalBlocks ?? 0,
                completedBlocks: planContent.completedBlocks ?? 0,
                estimatedMinutes: planContent.estimatedMinutes ?? 60,
                editedByUser: false,
              },
            },
            { upsert: true, returnDocument: "after" },
          );
        }
      }

      if (!studyPlanDoc) {
        throw new Error(
          `No study plan document or artifact found in zFlow output for session ${sessionId}`,
        );
      }

      // Attach study plan to the StudySession document and sync progress
      await StudySession.findByIdAndUpdate(sessionId, {
        $set: {
          studyPlan: studyPlanDoc._id,
          totalBlocks: studyPlanDoc.totalBlocks,
          completedBlocks: studyPlanDoc.completedBlocks,
          activeChapterId: studyPlanDoc.chapters?.[0]?.chapterId,
          activeStepId: studyPlanDoc.chapters?.[0]?.steps?.[0]?.stepId,
          activeBlockId:
            studyPlanDoc.chapters?.[0]?.steps?.[0]?.prerequisites?.[0]?.blockId,
        },
      });

      if (userId) {
        publishers.appStudyPlanUpdated(
          sessionId,
          userId,
          studyPlanDoc.toObject(),
        );
      }

      await PUBLISHERS.publishAppEvent("ai:generate_study_plan:completed", {
        sessionId,
        userId,
        studyPlanId: studyPlanDoc._id,
      });

      logger.info(
        `[handlers:studyPlanGenerate] Study plan generated and attached for session ${sessionId}`,
      );
    } catch (err: any) {
      logger.error(
        `[handlers:studyPlanGenerate] Error generating study plan for ${sessionId}: ${err.message}`,
      );
      await PUBLISHERS.publishAppEvent("ai:generate_study_plan:failed", {
        sessionId,
        userId,
        reason: err?.message,
      });
      throw err;
    }
  });

  // AI: Update study plan via zFlow session based on student's request / edits
  longQueue.register("ai:update_study_plan", async (job: Job) => {
    const { sessionId, userId, goal, instruction, materialIds, courseId } =
      job.payload as {
        sessionId: string;
        userId: string;
        goal?: string;
        instruction?: string;
        materialIds: string[];
        courseId?: string;
      };
    if (!isValidObjectId(sessionId)) {
      logger.error(
        `[handlers:studyPlanUpdate] Invalid sessionId: ${sessionId}`,
      );
      return;
    }
    try {
      const existingPlan = await StudyPlan.findOne({
        sessionId: new Types.ObjectId(sessionId),
      }).lean();

      const userInstruction = instruction || goal || "Update the study plan";

      const result = await FLOWS.zFlow({
        userId,
        trigger: "autonomous_gen",
        isAutonomous: true,
        payload: {
          taskLabel: "Update Study Plan",
          message: `The student requested an update to their study plan for session "${sessionId}". User request: "${userInstruction}". Current plan goal: "${existingPlan?.goal || goal || ""}". Please call 'update_study_plan' or 'generate_study_plan' with the updated chapters and topics tailored to the student's request.`,
          sourceSessionId: sessionId,
          materialIds,
          courseId,
          userId,
        },
        emit: () => {},
      });

      if (!result.success) {
        throw new Error(result.error || "zFlow failed to update study plan");
      }

      // Retrieve the updated study plan
      const studyPlanDoc = await StudyPlan.findOne({
        sessionId: new Types.ObjectId(sessionId),
      });

      if (studyPlanDoc) {
        await StudySession.findByIdAndUpdate(sessionId, {
          $set: {
            studyPlan: studyPlanDoc._id,
            totalBlocks: studyPlanDoc.totalBlocks,
            completedBlocks: studyPlanDoc.completedBlocks,
            activeChapterId: studyPlanDoc.chapters?.[0]?.chapterId,
            activeStepId: studyPlanDoc.chapters?.[0]?.steps?.[0]?.stepId,
            activeBlockId:
              studyPlanDoc.chapters?.[0]?.steps?.[0]?.prerequisites?.[0]
                ?.blockId,
          },
        });

        if (userId) {
          publishers.appStudyPlanUpdated(
            sessionId,
            userId,
            studyPlanDoc.toObject(),
          );
        }
      }

      await PUBLISHERS.publishAppEvent("ai:update_study_plan:completed", {
        sessionId,
        userId,
        studyPlanId: studyPlanDoc?._id,
      });

      logger.info(
        `[handlers:studyPlanUpdate] Study plan updated for session ${sessionId}`,
      );
    } catch (err: any) {
      logger.error(
        `[handlers:studyPlanUpdate] Error updating study plan for ${sessionId}: ${err.message}`,
      );
      await PUBLISHERS.publishAppEvent("ai:update_study_plan:failed", {
        sessionId,
        userId,
        reason: err?.message,
      });
      throw err;
    }
  });

  // AI: Synthesize or update course summary via transient zFlow session
  longQueue.register("ai:generate_course_summary", async (job: Job) => {
    const { sessionId, userId, materialIds, courseId } = job.payload as {
      sessionId: string;
      userId: string;
      materialIds: string[];
      courseId?: string;
    };
    if (!isValidObjectId(sessionId)) {
      logger.error(
        `[handlers:courseSummaryGenerate] Invalid sessionId: ${sessionId}`,
      );
      return;
    }
    try {
      const result = await FLOWS.zFlow({
        userId,
        trigger: "autonomous_gen",
        isAutonomous: true,
        payload: {
          taskLabel: "Generate Course Summary",
          message: `Please generate a comprehensive course summary for the session "${sessionId}". Use the search_materials tool to read all available materials, then call generate_course_summary to synthesize the summary.`,
          sourceSessionId: sessionId,
          materialIds,
          courseId,
          userId,
        },
        emit: () => {},
      });

      if (!result.success) {
        throw new Error(
          result.error || "zFlow failed to generate course summary",
        );
      }

      // Retrieve the generated or updated course summary
      let summaryDoc = await CourseSummary.findOne({
        sessionId: new Types.ObjectId(sessionId),
      });

      // Fallback: check if summary artifact exists in zFlow result
      if (!summaryDoc) {
        const summaryArtifact = result.artifacts?.find(
          (a) => a.type === "course_summary" || a.type === "summary",
        );
        if (summaryArtifact && summaryArtifact.content) {
          const content = summaryArtifact.content as any;
          summaryDoc = await CourseSummary.findOneAndUpdate(
            { sessionId: new Types.ObjectId(sessionId) },
            {
              $set: {
                sessionId: new Types.ObjectId(sessionId),
                userId: new Types.ObjectId(userId),
                courseId: courseId ? new Types.ObjectId(courseId) : undefined,
                title: summaryArtifact.title || "Course Summary",
                overview: content.overview || "",
                logicalPillars: content.logicalPillars || [],
                topicDeepDives: content.topicDeepDives || [],
                keyTakeaways: content.keyTakeaways || [],
                sections: content.sections || [],
              },
            },
            { upsert: true, returnDocument: "after" },
          );
        }
      }

      if (!summaryDoc) {
        throw new Error(
          `No course summary document or artifact found in zFlow output for session ${sessionId}`,
        );
      }

      // Attach course summary to the StudySession document
      await StudySession.findByIdAndUpdate(sessionId, {
        $set: {
          courseSummary: summaryDoc._id,
        },
      });

      if (userId) {
        publishers.appSignal(sessionId, userId, {
          type: "course_summary_updated",
          payload: summaryDoc,
          timestamp: new Date(),
        });
      }

      await PUBLISHERS.publishAppEvent("ai:generate_course_summary:completed", {
        sessionId,
        userId,
        summaryId: summaryDoc._id,
      });

      logger.info(
        `[handlers:courseSummaryGenerate] Course summary synthesized and attached for session ${sessionId}`,
      );
    } catch (err: any) {
      logger.error(
        `[handlers:courseSummaryGenerate] Error synthesizing course summary for ${sessionId}: ${err.message}`,
      );
      await PUBLISHERS.publishAppEvent("ai:generate_course_summary:failed", {
        sessionId,
        userId,
        reason: err?.message,
      });
      throw err;
    }
  });

  // AI: Generate system quiz questions from a topic
  longQueue.register("ai:generate_quiz", async (job: Job) => {
    const {
      quizId,
      courseId,
      topic,
      numberOfQuestions,
      questionTypes,
      difficulty,
      lectureTitle,
      createdBy,
      jobId,
      autoContext,
    } = job.payload as {
      quizId?: string;
      courseId: string;
      topic: string;
      numberOfQuestions: number;
      questionTypes: string[];
      difficulty: string;
      lectureTitle?: string;
      createdBy: string;
      jobId: string;
      autoContext?: {
        source?: "public_preexam" | "public_manual_trigger";
        examEntryId?: string;
        examSessionId?: string;
        examAt?: string;
        lectureKey?: string;
        generationId?: string;
        materialId?: string;
        lectureIndex?: number;
        totalLectures?: number;
      };
    };

    try {
      // Emit lecture started event for public manual trigger
      if (
        autoContext?.source === "public_manual_trigger" &&
        autoContext?.generationId
      ) {
        await publishers.publicQuizGenerationLectureStarted(createdBy, {
          generationId: autoContext.generationId,
          courseId,
          lectureTitle: lectureTitle || topic,
          lectureIndex: autoContext.lectureIndex ?? 0,
          totalLectures: autoContext.totalLectures ?? 1,
        });
      }

      const typeList = (questionTypes ?? ["mcq"]).join(", ");
      const prompt = `You are an expert academic quiz writer. Generate ${numberOfQuestions} high-quality ${difficulty} difficulty quiz questions about: "${topic}".

Question types to include: ${typeList}

Return ONLY valid JSON in this exact format:
{
  "lectureTitle": "${lectureTitle || topic}",
  "topics": [
    {
      "title": "Topic name",
      "questions": [
        {
          "type": "mcq",
          "question": "Question text here?",
          "options": ["Option A", "Option B", "Option C", "Option D"],
          "correctAnswer": "Option A",
          "explanation": "Brief explanation of why this is correct.",
          "difficulty": "${difficulty === "mixed" ? "intermediate" : difficulty}"
        }
      ]
    }
  ]
}

For "true-false" type: options should be ["True", "False"].
For "fill-in" type: options should be [], correctAnswer is the word/phrase.
For "short-answer" type: options should be [], correctAnswer is a model answer.
Do NOT prefix question text with type labels such as "True or False:", "Fill in the Blank:", "Essay:", "Short Answer:", "Multiple Choice:", or "MCQ:".
Do NOT prefix options with letters or numbering like "A.", "B)", "(C)", "1.", etc. Options must be plain text only.
For MCQ: if there is a single correct answer, put all choices in the "options" array and keep the question text clean. Only embed A/B/C/D items in the question text when the correct answer is a combination (e.g. "AB", "ACD"), and only then set options to combo strings.
Group questions by topic logically. Generate exactly ${numberOfQuestions} questions total.`;

      const response = await ai.generate({
        messages: [{ role: "user", content: [{ text: prompt }] }],
        config: { temperature: 0.4, maxOutputTokens: 8000 },
      });

      const text =
        response?.message?.content?.[0]?.text || response?.text || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch)
        throw new Error("No JSON in AI response for quiz generation");

      const parsed = JSON.parse(jsonMatch[0]) as {
        lectureTitle: string;
        topics: {
          title: string;
          questions: {
            type: string;
            question: string;
            options: string[];
            correctAnswer: string;
            explanation?: string;
            difficulty?: string;
          }[];
        }[];
      };

      // Save all questions to Question bank
      const topicsWithIds = await Promise.all(
        parsed.topics.map(async (t, topicIndex) => {
          const questionsByType: Record<string, Types.ObjectId[]> = {};
          for (const q of t.questions) {
            const normalizedType =
              q.type === "true-false" || q.type === "true_false"
                ? "true_false"
                : q.type === "fill-in" || q.type === "fill_in_blank"
                  ? "fill_in_blank"
                  : q.type === "short-answer" || q.type === "short_answer"
                    ? "short_answer"
                    : "mcq";
            const saved = await Question.create({
              courseId: new Types.ObjectId(courseId),
              question: stripQuestionTypePrefix(q.question),
              options: stripOptionPrefixes(q.options ?? []),
              answer: stripOptionPrefix(q.correctAnswer),
              type: normalizedType,
              explanation: q.explanation || "",
              author: new Types.ObjectId(createdBy),
              isModerated: true, // Admin-generated questions are pre-approved
            });
            if (!questionsByType[normalizedType])
              questionsByType[normalizedType] = [];
            questionsByType[normalizedType].push(saved._id as Types.ObjectId);
          }
          return {
            title: t.title,
            description: "",
            order: topicIndex,
            questionTypes: Object.entries(questionsByType).map(
              ([type, questions]) => ({
                type: type as
                  "mcq" | "true_false" | "short_answer" | "fill_in_blank",
                questions,
              }),
            ),
          };
        }),
      );

      // Calculate total questions generated
      const questionsGenerated = parsed.topics.reduce(
        (total, t) => total + t.questions.length,
        0,
      );

      if (quizId) {
        // Append lecture to existing quiz, preserving lecture order.
        const existingQuiz = await Quiz.findById(quizId)
          .select("lectures")
          .lean();
        if (!existingQuiz) {
          throw new Error(`Quiz not found: ${quizId}`);
        }

        const resolvedLectureTitle =
          parsed.lectureTitle || lectureTitle || topic;
        const alreadyExists = (existingQuiz.lectures || []).some(
          (lecture: any) =>
            lecture.title?.trim() === resolvedLectureTitle.trim(),
        );
        if (alreadyExists) {
          await redisConnection.set(
            `quiz:gen:result:${jobId}`,
            JSON.stringify({
              status: "completed",
              quizId,
              skippedDuplicate: true,
            }),
            "EX",
            3600,
          );
          return;
        }

        const newLecture = {
          lectureId: new Types.ObjectId(),
          title: resolvedLectureTitle,
          description: `AI-generated questions about ${topic}`,
          order: (existingQuiz.lectures || []).length,
          topics: topicsWithIds,
        };

        await Quiz.findByIdAndUpdate(quizId, {
          $push: { lectures: newLecture },
        });

        // Emit lecture completed event for public manual trigger
        if (
          autoContext?.source === "public_manual_trigger" &&
          autoContext?.generationId
        ) {
          const lectureIndex = autoContext.lectureIndex ?? 0;
          const totalLectures = autoContext.totalLectures ?? 1;
          const completedLectures = lectureIndex + 1; // Since this job just completed
          const percentComplete = Math.round(
            (completedLectures / totalLectures) * 100,
          );

          await publishers.publicQuizGenerationLectureCompleted(createdBy, {
            generationId: autoContext.generationId,
            courseId,
            lectureTitle: resolvedLectureTitle,
            lectureIndex,
            totalLectures,
            questionsGenerated,
            completedLectures,
            percentComplete,
          });
        }
      } else {
        // Create new quiz
        const resolvedLectureTitle =
          parsed.lectureTitle || lectureTitle || topic;
        const publicPreExamTag =
          autoContext?.source === "public_preexam" &&
          autoContext?.examEntryId &&
          autoContext?.examSessionId
            ? `auto_preexam:${autoContext.examEntryId}:${autoContext.examSessionId}`
            : null;

        const newLecture = {
          lectureId: new Types.ObjectId(),
          title: resolvedLectureTitle,
          description: `AI-generated questions about ${topic}`,
          order: 0,
          topics: topicsWithIds,
        };

        const newQuiz = await Quiz.create({
          title: resolvedLectureTitle,
          courseId: new Types.ObjectId(courseId),
          createdBy: new Types.ObjectId(createdBy),
          status:
            autoContext?.source === "public_preexam" ? "published" : "draft",
          isAvailable: autoContext?.source === "public_preexam",
          passingScore: 70,
          settings: {
            shuffleQuestions: true,
            showHints: true,
            showExplanations: true,
          },
          tags: [topic, ...(publicPreExamTag ? [publicPreExamTag] : [])],
          lectures: [newLecture],
        });

        // createdBy is the admin/creator who triggered generation, not a
        // student — this is admin-attributed, per §6a's "Quizzes" hook.
        emitEvent(
          "quiz:public_created",
          createdBy,
          { type: "quiz", id: newQuiz._id },
          { title: resolvedLectureTitle, courseId },
        );

        // Emit lecture completed event for public manual trigger
        if (
          autoContext?.source === "public_manual_trigger" &&
          autoContext?.generationId
        ) {
          const lectureIndex = autoContext.lectureIndex ?? 0;
          const totalLectures = autoContext.totalLectures ?? 1;
          const completedLectures = lectureIndex + 1; // Since this job just completed
          const percentComplete = Math.round(
            (completedLectures / totalLectures) * 100,
          );

          await publishers.publicQuizGenerationLectureCompleted(createdBy, {
            generationId: autoContext.generationId,
            courseId,
            lectureTitle: resolvedLectureTitle,
            lectureIndex,
            totalLectures,
            questionsGenerated,
            completedLectures,
            percentComplete,
          });
        }
      }

      await redisConnection.set(
        `quiz:gen:result:${jobId}`,
        JSON.stringify({ status: "completed", quizId }),
        "EX",
        3600,
      );
    } catch (err: any) {
      // Emit failure event for public manual trigger
      if (
        autoContext?.source === "public_manual_trigger" &&
        autoContext?.generationId
      ) {
        await publishers.publicQuizGenerationLectureFailed(createdBy, {
          generationId: autoContext.generationId,
          courseId,
          lectureTitle: lectureTitle || topic,
          error: err?.message || "Unknown error during quiz generation",
        });
      }

      await redisConnection.set(
        `quiz:gen:result:${jobId}`,
        JSON.stringify({ status: "failed", error: err?.message }),
        "EX",
        3600,
      );
      throw err;
    }
  });
}
