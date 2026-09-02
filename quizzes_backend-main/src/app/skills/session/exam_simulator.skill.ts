import { z } from "genkit";
import { nanoid } from "nanoid";
import { defineToolOnce, resolveSkillContext } from "../tool-context";
import { ISkill } from "../interfaces";
import { StudySession } from "../../models";
import { QuizContent, QuizQuestion } from "../../interfaces";
import { ai } from "@/ai";
import { runInTransaction } from "@/utils";
import { isValidObjectId } from "mongoose";
import { publishers } from "@/socket";

const startExamSimulationTool = defineToolOnce(
  {
    name: "start_exam_simulation",
    description:
      "Start a simulated written or oral exam with targeted questions, time limits, and rubric evaluation.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      format: z.enum(["written", "oral", "speed_drill"]).default("written"),
      questionCount: z.number().min(1).max(20).default(5),
      topicFocus: z.string().optional(),
      timeLimitMinutes: z.number().default(15),
    }),
  },
  async (input) => {
    const { format, questionCount, topicFocus, timeLimitMinutes } = input;
    const { sessionId, userId } = await resolveSkillContext(input);

    if (!sessionId || !isValidObjectId(sessionId)) {
      throw new Error("Invalid or missing sessionId");
    }

    const session = await StudySession.findById(sessionId).lean();
    if (!session) throw new Error("Session not found");

    const examQuestionsSchema = z.object({
      questions: z.array(
        z.object({
          text: z.string(),
          type: z.enum(["mcq", "short_answer", "essay", "true_false"]),
          options: z.array(z.string()).default([]),
          correctAnswer: z.string(),
          explanation: z.string(),
          hint: z.string().optional(),
        }),
      ),
    });

    const planArtifact = [...(session.artifacts || [])]
      .filter((a) => a.type === "study_plan")
      .sort((a, b) => {
        const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
        const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
        return bTime - aTime;
      })[0];

    const chapters = (planArtifact?.content as any)?.chapters || [];

    let questions: QuizQuestion[] = [];
    let lectures: any[] = [];

    if (chapters.length > 1 && !topicFocus) {
      // Parallel chapter-by-chapter dispatch for high-throughput, comprehensive coverage
      const countPerChapter = Math.max(
        Math.ceil(questionCount / chapters.length),
        1,
      );

      const chapterTasks = chapters.map(async (chapter: any) => {
        const chapterBlocks = (chapter.steps || []).flatMap(
          (s: any) => s.prerequisites || s.knowledgeBlocks || [],
        );
        const blockSummaries = chapterBlocks
          .map((b: any) => `- ${b.title}: ${b.summary || ""}`)
          .join("\n");

        const { output: chOutput } = await ai.generate({
          system:
            "You are an exam creator. Generate university-level exam questions targeting the specific concepts in this chapter.",
          prompt:
            `Generate ${countPerChapter} ${format} exam questions for Chapter: "${chapter.title}" (${chapter.description || ""}).\n\n` +
            (blockSummaries
              ? `KEY KNOWLEDGE BLOCKS:\n${blockSummaries}\n\n`
              : "") +
            `Return raw JSON matching schema.`,
          output: { format: "json", schema: examQuestionsSchema },
        });

        const rawParsed = chOutput?.questions || [];
        const chQuestions: QuizQuestion[] = rawParsed.map((q: any) => ({
          questionId: nanoid(),
          type: q.type,
          text: q.text,
          options: q.options,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          hint: q.hint,
        }));

        return {
          title: chapter.title,
          questions: chQuestions,
        };
      });

      const chapterResults = await Promise.all(chapterTasks);

      lectures = [
        {
          title: `Exam Simulation (${format.toUpperCase()})`,
          topics: chapterResults.map((cr) => ({
            title: cr.title,
            questions: cr.questions,
          })),
        },
      ];

      questions = chapterResults
        .flatMap((cr) => cr.questions)
        .slice(0, questionCount * 2);
    } else {
      // Single targeted generator
      const { output } = await ai.generate({
        system:
          "You are an exam creator. Generate realistic, challenging university exam questions that test both conceptual understanding and practical problem-solving.",
        prompt:
          `Generate ${questionCount} ${format} exam questions for the course: "${session.name}"` +
          (topicFocus ? ` focusing on: "${topicFocus}"` : "") +
          `\n\nEnsure questions test reasoning and application, not just rote recall.\nReturn raw JSON matching schema.`,
        output: { format: "json", schema: examQuestionsSchema },
      });

      const rawQuestions = output?.questions || [];
      questions = rawQuestions.map((q: any) => ({
        questionId: nanoid(),
        type: q.type,
        text: q.text,
        options: q.options,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
        hint: q.hint,
      }));

      lectures = [
        {
          title: `Exam Simulation (${format.toUpperCase()})`,
          topics: [
            {
              title: topicFocus || "Comprehensive Exam",
              questions,
            },
          ],
        },
      ];
    }

    const quizContent: QuizContent = {
      questions,
      lectures,
    };

    const artifactId = nanoid();

    await runInTransaction(async (txSession) => {
      await StudySession.findByIdAndUpdate(
        sessionId,
        {
          $push: {
            artifacts: {
              artifactId,
              type: "quiz",
              title: `${format === "oral" ? "Oral" : "Written"} Exam Simulation`,
              content: quizContent,
              phase: session.currentPhase || "verification",
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          },
        },
        { session: txSession },
      );
    });

    const title = `${format === "oral" ? "Oral" : "Written"} Exam Simulation`;

    if (userId) {
      publishers.appArtifact(sessionId, userId, artifactId, "quiz", title);
    }

    return {
      success: true,
      artifactId,
      format,
      questionCount: questions.length,
      timeLimitMinutes,
    };
  },
);

const examSimulatorSkill: ISkill = {
  name: "exam_simulator",
  displayName: "Exam Simulator",
  description:
    "Simulate written and oral exam conditions with timed drills and graded feedback.",
  scope: "session",
  category: "verification",
  tools: [startExamSimulationTool],
  phases: ["verification", "implementation"],
};

export default examSimulatorSkill;
