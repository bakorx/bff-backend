import { z } from "genkit";
import { ai } from "@/ai/config";
import { defineToolOnce, resolveSkillContext } from "../tool-context";
import { ISkill } from "../interfaces";
import { ArtifactServices } from "../../artifacts/services";
import { NOTES_PROMPT } from "../../prompts";

const generateNotesTool = defineToolOnce(
  {
    name: "generate_notes",
    description: "Generate a structured notes artifact for a topic.",
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
      throw new Error("userId or sessionId is required to generate notes");
    }

    const courseTitle = session?.name || "General Study";
    const knownConcepts = session?.memorySnapshot?.knownConcepts || [];

    const { output } = await ai.generate({
      prompt: NOTES_PROMPT({
        topicTitle,
        courseTitle,
        knownConcepts,
      }),
      output: {
        schema: z.object({
          topicTitle: z.string(),
          sections: z.array(
            z.object({
              title: z.string(),
              body: z.string(),
            }),
          ),
        }),
      },
    });

    if (!output) throw new Error("No output from notes generation");

    const artifact = await ArtifactServices.save(sessionId, userId, {
      type: "notes",
      title: output.topicTitle,
      content: {
        sections: output.sections,
      } as any,
      phase: session?.currentPhase || "idle",
      goalId,
    });

    return { artifactId: artifact.artifactId, artifact };
  },
);

const notesSkill: ISkill = {
  name: "notes",
  displayName: "Notes",
  description: "Generate detailed, structured study notes.",
  scope: "session",
  category: "implementation",
  tools: [generateNotesTool],
  phases: ["implementation"],
  autoEquip: (s) => s.mode === "structured",
};

export default notesSkill;
