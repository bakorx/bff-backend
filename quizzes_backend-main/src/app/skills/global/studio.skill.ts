import { z } from "genkit";
import { ai } from "@/ai/config";
import { defineToolOnce, resolveSkillContext } from "../tool-context";
import { ISkill } from "../interfaces";
import { ArtifactServices } from "../../artifacts/services";
import { ArtifactType, AgentPhase } from "../../interfaces";

const saveArtifactTool = defineToolOnce(
  {
    name: "save_artifact",
    description:
      "Save a newly generated artifact (lesson, quiz, flashcard set, mindmap, etc.) to the session.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      type: z.string(),
      title: z.string(),
      content: z.record(z.string(), z.any()).optional().default({}),
      phase: z.string(),
      goalId: z.string().nullish(),
    }),
  },
  async (input) => {
    const { type, title, content, phase } = input;
    const goalId = input.goalId ?? undefined;
    const { sessionId, userId } = await resolveSkillContext(input);

    if (!userId) {
      throw new Error("userId or sessionId is required to save an artifact");
    }
    const artifact = await ArtifactServices.save(sessionId, userId, {
      type: type as ArtifactType,
      title,
      content: content as never,
      phase: phase as AgentPhase,
      goalId,
    });
    return { artifactId: artifact.artifactId };
  },
);

const updateArtifactTool = defineToolOnce(
  {
    name: "update_artifact",
    description: "Update the title or content of an existing artifact.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      artifactId: z.string(),
      title: z.string().optional(),
      content: z.record(z.string(), z.any()).optional(),
    }),
  },
  async (input) => {
    const { artifactId, title, content } = input;
    const { sessionId, userId } = await resolveSkillContext(input);

    if (!userId) {
      throw new Error("userId or sessionId is required to update an artifact");
    }
    await ArtifactServices.update(sessionId, userId, artifactId, {
      title,
      content: content as never,
    });
    return { updated: true };
  },
);

const getArtifactTool = defineToolOnce(
  {
    name: "get_artifact",
    description: "Retrieve an artifact by its ID from the session.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      artifactId: z.string(),
    }),
  },
  async (input) => {
    const { artifactId } = input;
    const { sessionId } = await resolveSkillContext(input);
    return ArtifactServices.get(sessionId, artifactId);
  },
);

const studioSkill: ISkill = {
  name: "studio",
  displayName: "Studio",
  description: "Save, update and retrieve session artifacts.",
  scope: "global",
  category: "utility",
  tools: [saveArtifactTool, updateArtifactTool, getArtifactTool],
  phases: [],
};

export default studioSkill;
