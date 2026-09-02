import { z } from "genkit";
import { ai } from "@/ai/config";
import { defineToolOnce, resolveSkillContext } from "../tool-context";
import { ISkill } from "../interfaces";
import { ArtifactServices } from "../../artifacts/services";
import { MemoryServices } from "../../memory/services";
import { StudySession } from "../../models";
import { runInTransaction } from "@/utils";
import { WalkthroughContent } from "../../interfaces";

const WALKTHROUGH_PROMPT = (ctx: {
  goals: string;
  artifacts: string;
  sessionSummary: string;
}) =>
  `Generate a comprehensive session walkthrough based on this study session:
Goals: ${ctx.goals}
Completed Artifacts: ${ctx.artifacts}
Session: ${ctx.sessionSummary}

Identify mastered concepts, remaining gaps, and next steps.`;

const MINI_WALKTHROUGH_PROMPT = (ctx: {
  goalTitle: string;
  goalArtifacts: string;
}) =>
  `Generate a brief walkthrough for the completed goal: "${ctx.goalTitle}"
Artifacts produced: ${ctx.goalArtifacts}

Identify what was mastered, any gaps, and immediate next steps.`;

const generateWalkthroughTool = defineToolOnce(
  {
    name: "generate_walkthrough",
    description:
      "Generate a full session walkthrough at the end of the session.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      goals: z.array(z.string()).optional(),
      artifacts: z.array(z.string()).optional(),
    }),
  },
  async (input) => {
    const { session, userId, sessionId } = await resolveSkillContext(input);
    if (!userId) {
      throw new Error(
        "userId or sessionId is required to generate a walkthrough",
      );
    }

    const goalsStr =
      input.goals?.join(", ") ||
      session?.goals.map((g) => `${g.title} (${g.status})`).join(", ") ||
      "No goals tracked";
    const artifactsStr =
      input.artifacts?.join(", ") ||
      session?.artifacts.map((a) => a.title).join(", ") ||
      "No artifacts produced";
    const sessionName = session?.name || "General Session";
    const { output } = await ai.generate({
      prompt: WALKTHROUGH_PROMPT({
        goals: goalsStr,
        artifacts: artifactsStr,
        sessionSummary: sessionName,
      }),
      output: {
        schema: z.object({
          mastered: z.array(z.string()),
          gaps: z.array(z.string()),
          recommendations: z.array(z.string()),
          nextSteps: z.array(z.string()),
          sessionSummary: z.string(),
        }),
      },
    });
    if (!output) throw new Error("No output from walkthrough generation");
    const content: WalkthroughContent = { ...output, type: "full" };
    const artifact = await ArtifactServices.save(sessionId, userId, {
      type: "walkthrough",
      title: "Session Walkthrough",
      content,
      phase: "signoff",
    });
    await MemoryServices.update(userId, session?.courseId?.toString(), {
      addMasteredGoals: output.mastered,
      addGaps: output.gaps,
    });
    return { artifactId: artifact.artifactId };
  },
);

const generateMiniWalkthroughTool = defineToolOnce(
  {
    name: "generate_mini_walkthrough",
    description: "Generate a brief walkthrough after completing a goal.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      goalId: z.string(),
      goalTitle: z.string(),
      goalArtifacts: z.array(z.string()).optional(),
    }),
  },
  async (input) => {
    const { goalId, goalTitle } = input;
    const { session, userId, sessionId } = await resolveSkillContext(input);

    if (!userId) {
      throw new Error(
        "userId or sessionId is required to generate a mini walkthrough",
      );
    }

    const goalArtifactsStr =
      input.goalArtifacts?.join(", ") ||
      session?.artifacts
        .filter((a) => a.goalId === goalId)
        .map((a) => a.title)
        .join(", ") ||
      "No artifacts produced for this goal";
    const { output } = await ai.generate({
      prompt: MINI_WALKTHROUGH_PROMPT({
        goalTitle,
        goalArtifacts: goalArtifactsStr,
      }),
      output: {
        schema: z.object({
          mastered: z.array(z.string()),
          gaps: z.array(z.string()),
          recommendations: z.array(z.string()),
          nextSteps: z.array(z.string()),
        }),
      },
    });
    if (!output) throw new Error("No output from mini walkthrough");
    const content: WalkthroughContent = {
      ...output,
      type: "mini",
      goalId,
      goalTitle,
    };
    const artifact = await ArtifactServices.save(sessionId, userId, {
      type: "mini_walkthrough",
      title: `Goal Complete — ${goalTitle}`,
      content,
      phase: "signoff",
      goalId,
    });
    if (sessionId) {
      await runInTransaction(async (txSession) => {
        await StudySession.findOneAndUpdate(
          { _id: sessionId, "goals.goalId": goalId },
          {
            $set: {
              "goals.$.miniWalkthroughId": artifact.artifactId,
              "goals.$.status": "completed",
              "goals.$.completedAt": new Date(),
            },
          },
          { session: txSession },
        );
      });
    }
    return { artifactId: artifact.artifactId };
  },
);

const walkthroughSkill: ISkill = {
  name: "walkthrough",
  displayName: "Walkthrough",
  description: "Generate session and goal walkthroughs at signoff.",
  scope: "session",
  category: "signoff",
  tools: [generateWalkthroughTool, generateMiniWalkthroughTool],
  phases: ["signoff"],
  autoEquip: (s) => s.mode === "structured",
};

export default walkthroughSkill;
