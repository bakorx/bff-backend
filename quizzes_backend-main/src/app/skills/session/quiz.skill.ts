import { z } from "genkit";
import { ai } from "@/ai/config";
import { defineToolOnce, resolveSkillContext } from "../tool-context";
import { ISkill } from "../interfaces";
import { ArtifactServices } from "../../artifacts/services";
import { StudySession } from "../../models";
import {
  runInTransaction,
  stripOptionPrefix,
  stripOptionPrefixes,
  stripQuestionTypePrefix,
} from "@/utils";
import { QuizContent } from "../../interfaces";
import { nanoid } from "nanoid";
import {
  services as materialServices,
  selectors as learningSelectors,
} from "@/learning";

// ─── Shared prompt fragments ──────────────────────────────────────────────────

const MCQ_FORMAT_RULES =
  `MCQ FORMAT RULES:\n` +
  `Format 1 — Standard (use for ALL single-answer questions): clean question text, put answer choices in the "options" array, set "correctAnswer" to match the correct option text exactly.\n` +
  `  e.g. text="Which OSI layer handles routing?", options=["Network","Transport","Session","Application"], correctAnswer="Network"\n\n` +
  `Format 2 — Combination-answer only (use ONLY when the correct answer is a combination of multiple items, e.g. "AB", "ACD"): embed the individual items as A/B/C/D in the question text using <br> tags; set options to combination strings like ["AB","AC","BD","All of the above"]; set correctAnswer to the correct combo.\n` +
  `  e.g. text="Which of the following are valid?<br>A. Option one<br>B. Option two<br>C. Option three<br>D. Option four", options=["AB","BC","BD","All of the above"], correctAnswer="BD"\n` +
  `  ONLY use Format 2 when the question genuinely tests a multi-item combination. If there is a single correct answer, always use Format 1.\n\n`;

const FIELD_RULES =
  `FIELD RULES:\n` +
  `- explanation: detailed reasoning for WHY the correct answer is correct\n` +
  `- hint: a short nudge that helps the student without giving away the answer\n` +
  `- Do NOT prefix question text with "Question X." or any numbering\n` +
  `- Do NOT prefix question text with its type label (e.g. "True or False:", "Fill in the Blank:", "Essay:", "Short Answer:")\n` +
  `- Do NOT prefix options with letters or numbering (e.g. "A.", "B)", "(C)", "1."). Options must be plain text only\n\n`;

const FOCUS_ON =
  `FOCUS ON:\n` +
  `- Core concepts and theories\n` +
  `- Key definitions\n` +
  `- Important processes and methods\n` +
  `- Real-world applications\n` +
  `- Critical relationships between concepts\n\n`;

// ─── Per-topic question generation prompt ─────────────────────────────────────

function buildTopicPrompt(ctx: {
  topicTitle: string;
  lectureTitle: string;
  count: number;
  typeDistribution: string;
  difficulty: string;
  context: string;
}): string {
  return (
    `You are generating quiz questions for the topic "${ctx.topicTitle}" (part of "${ctx.lectureTitle}").\n\n` +
    `TARGET: Generate exactly ${ctx.count} questions — no more, no fewer.\n\n` +
    `DIFFICULTY DISTRIBUTION:\n` +
    `- easy (basic recall & definitions): ~30%\n` +
    `- medium (application & understanding): ~40%\n` +
    `- hard (analysis, synthesis, critical thinking): ~30%\n\n` +
    `TYPE DISTRIBUTION:\n${ctx.typeDistribution}\n\n` +
    MCQ_FORMAT_RULES +
    FOCUS_ON +
    `STRICTLY AVOID:\n` +
    `- Course/department names, credit hours, lecturer information\n` +
    `- Administrative or formatting details from the material\n` +
    `- Duplicating question intent within this set\n\n` +
    FIELD_RULES +
    (ctx.context ? `STUDY MATERIAL:\n${ctx.context}\n\n` : "") +
    `Return raw JSON only.`
  );
}

function buildTypeDistribution(
  types: string[],
  count: number,
  isPublic: boolean,
): string {
  if (isPublic) {
    const mcq = Math.max(1, Math.round(count * 0.65));
    const tf = Math.max(1, Math.round(count * 0.2));
    const fib = Math.max(1, Math.round(count * 0.1));
    const sa = Math.max(1, count - mcq - tf - fib);
    return (
      `- mcq: ${mcq}\n` +
      `- true_false: ${tf}\n` +
      `- fill_in_blank: ${fib}\n` +
      `- short_answer: ${sa}\n` +
      `- essay: 0 unless absolutely necessary`
    );
  }
  // Distribute evenly across requested types
  const perType = Math.max(1, Math.floor(count / types.length));
  const remainder = count - perType * types.length;
  return types
    .map((t, i) => `- ${t}: ~${perType + (i === 0 ? remainder : 0)}`)
    .join("\n");
}

// ─── Question schema ──────────────────────────────────────────────────────────

const questionSchema = z.object({
  questionId: z.string().optional(),
  type: z.enum([
    "mcq",
    "true_false",
    "true-false",
    "short_answer",
    "short-answer",
    "fill_in_blank",
    "fill-in-blank",
    "essay",
  ]),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  text: z.string(),
  options: z.array(z.string()).default([]),
  correctAnswer: z.string(),
  hint: z.string().optional(),
  explanation: z.string(),
});

// ─── Tool ─────────────────────────────────────────────────────────────────────

const ANSWER_EVALUATION_PROMPT = (ctx: {
  question: string;
  studentAnswer: string;
}) =>
  `Evaluate this student answer:
Question: ${ctx.question}
Student Answer: ${ctx.studentAnswer}

Assess correctness, provide feedback, and identify the key mistake if any.`;

const generateQuizTool = defineToolOnce(
  {
    name: "generate_quiz",
    description: "Generate a quiz artifact for a topic.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      topicTitle: z.string(),
      questionTypes: z.array(z.string()),
      count: z.number(),
      difficulty: z.enum(["easy", "medium", "hard"]),
      quizPreset: z.enum(["public"]).optional(),
      goalId: z.string().nullish(),
    }),
  },
  async (input) => {
    const { topicTitle, questionTypes, count, difficulty, goalId, quizPreset } =
      input;
    const { sessionId, userId } = await resolveSkillContext(input);

    if (!userId) {
      throw new Error("userId or sessionId is required to generate a quiz");
    }

    const isPublic = quizPreset === "public";
    const targetCount = isPublic ? Math.max(count || 50, 40) : count || 20;
    const types = isPublic
      ? ["mcq", "true_false", "fill_in_blank", "short_answer"]
      : questionTypes;

    // ── Step 1: Gather material context via parallel semantic search ──────────

    let materialContext = "";

    if (sessionId) {
      const { output: queryPlan } = await ai.generate({
        system:
          "You are a study material analyst. Output ONLY a valid JSON object. No markdown, no extra text.",
        prompt:
          `You are preparing to generate a comprehensive quiz about "${topicTitle}". ` +
          `Generate 5 targeted semantic search queries that will retrieve the most exam-relevant content. ` +
          `Each query should target a distinct knowledge area (concepts, definitions, processes, applications, comparisons). ` +
          `Return JSON: { "queries": ["query1", "query2", ...] }`,
        output: {
          format: "json",
          schema: z.object({ queries: z.array(z.string()).min(3).max(6) }),
        },
      });

      const queries: string[] =
        queryPlan?.queries?.length > 0
          ? queryPlan.queries
          : [
              `${topicTitle} concepts and definitions`,
              `${topicTitle} key principles`,
              `${topicTitle} examples and applications`,
              `${topicTitle} processes and procedures`,
              `${topicTitle} comparisons and exceptions`,
            ];

      const searchResults = await Promise.all(
        queries.map((q) => materialServices.search(sessionId, q, 8)),
      );

      const seen = new Set<string>();
      const chunks = searchResults.flat().filter((c) => {
        if (seen.has(c.chunkId)) return false;
        seen.add(c.chunkId);
        return true;
      });

      if (chunks.length > 0) {
        materialContext = chunks
          .map((c, i) => `[${i + 1}] ${c.text}`)
          .join("\n\n")
          .slice(0, 12_000);
      }
    }

    // ── Step 2: Extract lecture/topic outline ─────────────────────────────────

    let outline: {
      lectures: { title: string; topics: { title: string }[] }[];
    } | null = null;

    if (materialContext) {
      const { output: outlineOutput } = await ai.generate({
        system:
          "You are a study material analyst. Output ONLY a valid JSON object. No markdown, no extra text.",
        prompt:
          `Analyse the material for "${topicTitle}" and extract its lecture and topic structure. ` +
          `Each lecture should have 1–4 topics. Cover all distinct areas of the material.\n\n` +
          `MATERIAL:\n${materialContext}\n\nReturn raw JSON only.`,
        output: {
          format: "json",
          schema: z.object({
            lectures: z.array(
              z.object({
                title: z.string(),
                topics: z.array(z.object({ title: z.string() })),
              }),
            ),
          }),
        },
      });
      if (outlineOutput?.lectures?.length) outline = outlineOutput;
    }

    // Fallback: single lecture/topic when no material context
    if (!outline) {
      outline = {
        lectures: [{ title: topicTitle, topics: [{ title: topicTitle }] }],
      };
    }

    // ── Step 3: Parallel per-topic question generation ────────────────────────

    const totalTopics = outline.lectures.reduce(
      (sum, l) => sum + l.topics.length,
      0,
    );
    const perTopic = Math.max(2, Math.ceil(targetCount / totalTopics));

    const topicJobs = outline.lectures.flatMap((l, lIdx) =>
      l.topics.map((t, tIdx) => ({
        lectureTitle: l.title,
        lectureOrder: lIdx,
        topicTitle: t.title,
        topicOrder: tIdx,
        questionsPerTopic: perTopic,
      })),
    );

    const topicResults = await Promise.all(
      topicJobs.map(
        async ({
          lectureTitle,
          lectureOrder,
          topicTitle: tTitle,
          topicOrder,
          questionsPerTopic,
        }) => {
          // Fetch topic-specific chunks when we have a session
          let topicContext = materialContext.slice(0, 4_000);
          if (sessionId && materialContext) {
            const topicChunks = await materialServices.search(
              sessionId,
              `${tTitle} ${lectureTitle}`,
              8,
            );
            if (topicChunks.length > 0) {
              topicContext = topicChunks
                .map((c, i) => `[${i + 1}] ${c.text}`)
                .join("\n\n");
            }
          }

          const typeDistribution = buildTypeDistribution(
            types,
            questionsPerTopic,
            isPublic,
          );

          const { output: topicOutput } = await ai.generate({
            system:
              'You are a Quiz Generation Engine. Return ONLY a raw JSON object with a single key "questions" whose value is an array of question objects. ' +
              "Do NOT output a JSON schema or schema definition — output actual question data. No markdown, no backticks, no explanatory text.",
            prompt: buildTopicPrompt({
              topicTitle: tTitle,
              lectureTitle,
              count: questionsPerTopic,
              typeDistribution,
              difficulty,
              context: topicContext,
            }),
            output: {
              format: "json",
              schema: z.object({ questions: z.array(questionSchema) }),
            },
          });

          const rawQuestions: any[] =
            topicOutput?.questions ??
            topicOutput?.properties?.questions?.items ??
            [];

          const questions = rawQuestions.map((q: any) => ({
            ...q,
            questionId: q.questionId || nanoid(),
            type: (q.type as string).replace("-", "_") as any,
            text: stripQuestionTypePrefix(q.text),
            options: stripOptionPrefixes(q.options ?? []),
            correctAnswer: stripOptionPrefix(q.correctAnswer),
          }));

          return {
            lectureTitle,
            lectureOrder,
            topicTitle: tTitle,
            topicOrder,
            questions,
          };
        },
      ),
    );

    // ── Step 4: Sort and rebuild lecture structure ─────────────────────────────

    topicResults.sort(
      (a, b) => a.lectureOrder - b.lectureOrder || a.topicOrder - b.topicOrder,
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

    const allQuestions: any[] = lectures.flatMap((l) =>
      l.topics.flatMap((t) => t.questions),
    );

    if (allQuestions.length === 0) {
      throw new Error("Quiz generation produced no questions");
    }

    // ── Step 5: Dedup against existing artifact and save ──────────────────────

    const existingArtifact = await ArtifactServices.getLatest(
      sessionId,
      "quiz",
    );
    const existingQuestions = existingArtifact
      ? ((existingArtifact.content as QuizContent).questions ?? [])
      : [];

    const existingTexts = new Set(
      existingQuestions.map((q) => q.text.trim().toLowerCase()),
    );
    const uniqueNewQuestions = allQuestions.filter(
      (q) => !existingTexts.has(q.text.trim().toLowerCase()),
    );

    if (existingArtifact && sessionId) {
      const existingContent = existingArtifact.content as QuizContent;
      const merged: QuizContent = {
        questions: [...existingContent.questions, ...uniqueNewQuestions] as any,
        lectures: existingContent.lectures,
      };
      await ArtifactServices.update(
        sessionId,
        userId,
        existingArtifact.artifactId,
        {
          content: merged as never,
        },
      );
      return {
        artifactId: existingArtifact.artifactId,
        questionCount: uniqueNewQuestions.length,
        totalQuestions: merged.questions.length,
        duplicatesSkipped: allQuestions.length - uniqueNewQuestions.length,
        merged: true,
      };
    }

    const normalizedOutput: QuizContent = {
      questions: uniqueNewQuestions as any,
      lectures: lectures as any,
    };
    const artifact = await ArtifactServices.save(
      sessionId ?? undefined,
      userId ?? undefined,
      {
        type: "quiz",
        title: topicTitle,
        content: normalizedOutput,
        phase: "implementation",
        goalId: goalId ?? undefined,
      },
    );
    return {
      artifactId: artifact.artifactId,
      questionCount: uniqueNewQuestions.length,
      totalQuestions: uniqueNewQuestions.length,
      merged: false,
    };
  },
);

const evaluateAnswersTool = defineToolOnce(
  {
    name: "evaluate_answers",
    description: "Evaluate student answers against a quiz artifact.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      artifactId: z.string(),
      answers: z.array(
        z.object({ questionId: z.string(), answer: z.string() }),
      ),
    }),
  },
  async (input) => {
    const { artifactId, answers } = input;
    const { sessionId } = await resolveSkillContext(input);
    const artifact = await ArtifactServices.get(sessionId, artifactId);
    if (!artifact) throw new Error("Quiz artifact not found");
    const quiz = artifact.content as QuizContent;
    let correct = 0;
    const feedbacks: string[] = [];
    for (const answer of answers) {
      const question = quiz.questions.find(
        (q) => q.questionId === answer.questionId,
      );
      if (!question) continue;
      if (question.type === "mcq" || question.type === "true_false") {
        if (
          question.correctAnswer &&
          answer.answer.toLowerCase() === question.correctAnswer.toLowerCase()
        ) {
          correct++;
        } else {
          feedbacks.push(`Q: ${question.text} — ${question.explanation}`);
        }
      } else {
        const { output } = await ai.generate({
          prompt: ANSWER_EVALUATION_PROMPT({
            question: question.text,
            studentAnswer: answer.answer,
          }),
          output: {
            schema: z.object({
              correct: z.boolean(),
              partialCredit: z.number().min(0).max(1),
              feedback: z.string(),
              keyMistake: z.string().nullable(),
            }),
          },
        });
        if (output?.correct) correct++;
        if (output?.feedback) feedbacks.push(output.feedback);
      }
    }
    const score =
      answers.length > 0 ? Math.round((correct / answers.length) * 100) : 0;
    return {
      score,
      passed: score >= 70,
      feedback: feedbacks.join("\n"),
      wrongAnswers: answers.length - correct,
    };
  },
);

const saveQuizToBankTool = defineToolOnce(
  {
    name: "save_quiz_to_bank",
    description: "Save a quiz artifact to the student's personal quiz bank.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      artifactId: z.string(),
    }),
  },
  async (input) => {
    const { artifactId } = input;
    const { sessionId } = await resolveSkillContext(input);
    const artifact = await ArtifactServices.get(sessionId, artifactId);
    if (!artifact) throw new Error("Quiz artifact not found");

    if (!sessionId) {
      return { quizId: nanoid(), note: "Virtual save (no session)" };
    }
    let quizId = "";
    await runInTransaction(async (txSession) => {
      const newQuizId = nanoid();
      quizId = newQuizId;
      await StudySession.findByIdAndUpdate(
        sessionId,
        { $addToSet: { "studio.savedQuizIds": newQuizId } },
        { session: txSession, returnDocument: "after" },
      );
    });
    return { quizId };
  },
);

const askQuestionTool = defineToolOnce(
  {
    name: "ask_question",
    description:
      "Ask a targeted single verification or practice question to the student using quiz types (mcq, true_false, fill_in_blank, short_answer, essay).",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      topicTitle: z.string().default("Knowledge Check"),
      type: z
        .enum(["mcq", "true_false", "fill_in_blank", "short_answer", "essay"])
        .default("mcq"),
      text: z.string().describe("Question text"),
      options: z.array(z.string()).default([]),
      correctAnswer: z.string().describe("The correct answer"),
      explanation: z
        .string()
        .describe("Explanation for why the answer is correct"),
      hint: z.string().optional(),
    }),
  },
  async (input) => {
    const { sessionId, userId } = await resolveSkillContext(input);
    const {
      topicTitle,
      type,
      text,
      options,
      correctAnswer,
      explanation,
      hint,
    } = input;

    const question: any = {
      questionId: nanoid(),
      type,
      text,
      options: options || [],
      correctAnswer,
      explanation,
      hint,
    };

    const quizContent: QuizContent = {
      questions: [question],
      lectures: [
        {
          title: topicTitle,
          topics: [
            {
              title: topicTitle,
              questions: [question],
            },
          ],
        },
      ],
    };

    const artifact = await ArtifactServices.save(
      sessionId ?? undefined,
      userId ?? undefined,
      {
        type: "quiz",
        title: topicTitle,
        content: quizContent,
        phase: "implementation",
      },
    );

    return {
      success: true,
      artifactId: artifact.artifactId,
      questionId: question.questionId,
      type,
      text,
      options,
    };
  },
);

const getQuizTool = defineToolOnce(
  {
    name: "get_quiz",
    description:
      "Read or search quiz artifacts in the session or personal quiz bank with search keyword filters, question type filters, and pagination.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      artifactId: z.string().optional(),
      search: z
        .string()
        .optional()
        .describe("Search term matching question text, topic, or options"),
      questionType: z
        .enum(["mcq", "true_false", "fill_in_blank", "short_answer", "essay"])
        .optional(),
      includeSaved: z
        .boolean()
        .optional()
        .describe("Query the user's permanent saved quiz bank"),
      page: z.number().optional(),
      limit: z.number().optional(),
    }),
  },
  async (input) => {
    const { sessionId, userId } = await resolveSkillContext(input);
    const {
      artifactId,
      search,
      questionType,
      includeSaved,
      page = 1,
      limit = 10,
    } = input;

    // If querying saved quiz bank
    if (includeSaved && userId) {
      const savedQuizzes = await learningSelectors.getPersonalQuizzesByUser(
        userId,
        {
          search,
          page,
          limit,
          searchFields: ["title", "description", "topic"],
        },
      );
      return {
        success: true,
        source: "quiz_bank",
        totalQuizzes: savedQuizzes.length,
        quizzes: savedQuizzes,
      };
    }

    let artifact;
    if (artifactId) {
      artifact = await ArtifactServices.get(sessionId, artifactId);
    } else {
      artifact = await ArtifactServices.getLatest(sessionId, "quiz");
    }

    if (!artifact) {
      return {
        success: false,
        exists: false,
        reason: "No quiz artifact found",
      };
    }

    const content = artifact.content as QuizContent;
    let questions = [...(content.questions || [])];

    if (questionType) {
      questions = questions.filter((q) => q.type === questionType);
    }

    if (search) {
      const searchLower = search.toLowerCase();
      questions = questions.filter(
        (q) =>
          q.text.toLowerCase().includes(searchLower) ||
          (q.options || []).some((o) =>
            o.toLowerCase().includes(searchLower),
          ) ||
          (q.explanation || "").toLowerCase().includes(searchLower),
      );
    }

    const totalQuestions = questions.length;
    const startIndex = (page - 1) * limit;
    const paginatedQuestions = questions.slice(startIndex, startIndex + limit);

    return {
      success: true,
      exists: true,
      artifactId: artifact.artifactId,
      title: artifact.title,
      totalQuestions,
      page,
      limit,
      totalPages: Math.ceil(totalQuestions / limit),
      questions: paginatedQuestions,
      content: {
        ...content,
        questions: paginatedQuestions,
      },
    };
  },
);

const updateQuizQuestionTool = defineToolOnce(
  {
    name: "update_quiz_question",
    description:
      "Update an existing question in a quiz artifact without recreating the entire quiz.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      artifactId: z.string(),
      questionId: z.string(),
      text: z.string().optional(),
      options: z.array(z.string()).optional(),
      correctAnswer: z.string().optional(),
      explanation: z.string().optional(),
      hint: z.string().optional(),
    }),
  },
  async (input) => {
    const { sessionId, userId } = await resolveSkillContext(input);
    const {
      artifactId,
      questionId,
      text,
      options,
      correctAnswer,
      explanation,
      hint,
    } = input;

    const artifact = await ArtifactServices.get(sessionId, artifactId);
    if (!artifact) throw new Error("Quiz artifact not found");

    const content = artifact.content as QuizContent;
    let found = false;

    // Update in questions array
    (content.questions || []).forEach((q) => {
      if (q.questionId === questionId) {
        if (text) q.text = text;
        if (options) q.options = options;
        if (correctAnswer) q.correctAnswer = correctAnswer;
        if (explanation) q.explanation = explanation;
        if (hint !== undefined) q.hint = hint;
        found = true;
      }
    });

    // Update in lectures/topics hierarchy
    (content.lectures || []).forEach((lec) => {
      (lec.topics || []).forEach((top) => {
        (top.questions || []).forEach((q) => {
          if (q.questionId === questionId) {
            if (text) q.text = text;
            if (options) q.options = options;
            if (correctAnswer) q.correctAnswer = correctAnswer;
            if (explanation) q.explanation = explanation;
            if (hint !== undefined) q.hint = hint;
            found = true;
          }
        });
      });
    });

    if (!found)
      return { success: false, reason: "Question ID not found in quiz" };

    await ArtifactServices.update(sessionId, userId, artifactId, {
      content: content as never,
    });

    return { success: true, artifactId, questionId, updated: true };
  },
);

const deleteQuizQuestionTool = defineToolOnce(
  {
    name: "delete_quiz_question",
    description: "Delete a question from a quiz artifact.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      artifactId: z.string(),
      questionId: z.string(),
    }),
  },
  async (input) => {
    const { sessionId, userId } = await resolveSkillContext(input);
    const { artifactId, questionId } = input;

    const artifact = await ArtifactServices.get(sessionId, artifactId);
    if (!artifact) throw new Error("Quiz artifact not found");

    const content = artifact.content as QuizContent;
    content.questions = (content.questions || []).filter(
      (q) => q.questionId !== questionId,
    );

    (content.lectures || []).forEach((lec) => {
      (lec.topics || []).forEach((top) => {
        top.questions = (top.questions || []).filter(
          (q) => q.questionId !== questionId,
        );
      });
    });

    await ArtifactServices.update(sessionId, userId, artifactId, {
      content: content as never,
    });

    return {
      success: true,
      artifactId,
      questionId,
      remainingQuestions: content.questions.length,
    };
  },
);

const quizSkill: ISkill = {
  name: "quiz",
  displayName: "Quiz",
  description:
    "Generate, read, update, and evaluate quizzes and individual questions.",
  scope: "session",
  category: "implementation",
  tools: [
    getQuizTool,
    generateQuizTool,
    askQuestionTool,
    updateQuizQuestionTool,
    deleteQuizQuestionTool,
    evaluateAnswersTool,
    saveQuizToBankTool,
  ],
  phases: ["implementation", "verification"],
  autoEquip: (s) => s.mode === "structured",
};

export default quizSkill;
