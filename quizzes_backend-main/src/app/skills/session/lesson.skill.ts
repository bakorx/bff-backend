import { z } from "genkit";
import { ai } from "@/ai/config";
import { defineToolOnce, resolveSkillContext } from "../tool-context";
import { ISkill } from "../interfaces";
import { ArtifactServices } from "../../artifacts/services";

const LESSON_PROMPT = (ctx: {
  topicTitle: string;
  courseTitle: string;
  knownConcepts: string[];
}) =>
  `Create a detailed lesson on: ${ctx.topicTitle}
Course: ${ctx.courseTitle}
Student already knows: ${ctx.knownConcepts.slice(0, 10).join(", ") || "nothing yet"}

Produce a comprehensive lesson that builds on prior knowledge, includes clear examples, and ends with key takeaways.`;

const generateLessonTool = defineToolOnce(
  {
    name: "generate_lesson",
    description: "Generate a structured lesson artifact for a topic.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      topicTitle: z.string(),
      goalId: z.string().nullish(),
    }),
  },
  async (input) => {
    const { topicTitle } = input;
    const goalId = input.goalId ?? undefined;
    const { session, userId, sessionId } = await resolveSkillContext(input);

    if (!userId) {
      throw new Error("userId or sessionId is required to generate a lesson");
    }

    const courseTitle = session?.name || "General Study";
    const knownConcepts = session?.memorySnapshot?.knownConcepts || [];

    const { output } = await ai.generate({
      prompt: LESSON_PROMPT({
        topicTitle,
        courseTitle,
        knownConcepts,
      }),
      output: {
        schema: z.object({
          topicTitle: z.string(),
          body: z.string(),
          keyPoints: z.array(z.string()),
          examples: z.array(
            z.object({ label: z.string(), content: z.string() }),
          ),
          analogy: z.string().optional(),
        }),
      },
    });

    if (!output) throw new Error("No output from lesson generation");

    const artifact = await ArtifactServices.save(sessionId, userId, {
      type: "lesson",
      title: output.topicTitle,
      content: output as never,
      phase: session?.currentPhase || "idle",
      goalId,
    });

    return { artifactId: artifact.artifactId, artifact };
  },
);

const lessonSkill: ISkill = {
  name: "lesson",
  displayName: "Lesson",
  description: "Generate lesson artifacts during implementation.",
  scope: "session",
  category: "implementation",
  tools: [generateLessonTool],
  phases: ["implementation"],
  autoEquip: (s) => s.mode === "structured",
};

export default lessonSkill;
