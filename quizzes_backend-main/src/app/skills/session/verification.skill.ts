import { z } from "genkit";
import { ai } from "@/ai/config";
import { defineToolOnce, resolveSkillContext } from "../tool-context";
import { ISkill } from "../interfaces";
import { ArtifactServices } from "../../artifacts/services";
import { VerificationContent } from "../../interfaces";
import { emit as emitEvent } from "@/events/services";

const EVALUATE_TEACHBACK_PROMPT = (ctx: {
  topic: string;
  studentResponse: string;
}) =>
  `Evaluate this student's teach-back explanation:
Topic: ${ctx.topic}
Student Response: ${ctx.studentResponse}

Assess whether the student demonstrates understanding. Be fair but rigorous.`;

const createVerificationTool = defineToolOnce(
  {
    name: "create_verification",
    description:
      "Create a verification artifact (quiz or teachback) for a goal.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      method: z.enum(["quiz", "teachback", "both"]),
      goalId: z.string().nullish(),
    }),
  },
  async (input) => {
    const { method } = input;
    const goalId = input.goalId ?? undefined;
    const { sessionId, userId } = await resolveSkillContext(input);

    if (!userId) {
      throw new Error(
        "userId or sessionId is required to create a verification",
      );
    }
    const content: VerificationContent = {
      method,
      teachbackPrompt:
        method !== "quiz"
          ? "Explain what you've learned in your own words."
          : undefined,
      passed: false,
      feedback: "",
    };
    const artifact = await ArtifactServices.save(sessionId, userId, {
      type: "verification",
      title: "Verification",
      content,
      phase: "verification",
      goalId,
    });
    return { artifactId: artifact.artifactId, method };
  },
);

const evaluateVerificationTool = defineToolOnce(
  {
    name: "evaluate_verification",
    description:
      "Evaluate a student's verification response (teachback or quiz answers).",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      artifactId: z.string(),
      studentResponse: z.string(),
    }),
  },
  async (input) => {
    const { artifactId, studentResponse } = input;
    const { sessionId, userId } = await resolveSkillContext(input);

    if (!userId) {
      throw new Error(
        "userId or sessionId is required to evaluate verification",
      );
    }
    const artifact = await ArtifactServices.get(sessionId, artifactId);
    if (!artifact) throw new Error("Verification artifact not found");
    const verification = artifact.content as VerificationContent;
    const { output } = await ai.generate({
      prompt: EVALUATE_TEACHBACK_PROMPT({
        topic: artifact.title,
        studentResponse,
      }),
      output: {
        schema: z.object({
          passed: z.boolean(),
          score: z.number().min(0).max(100),
          feedback: z.string(),
        }),
      },
    });
    if (!output) throw new Error("No output from evaluation");
    await ArtifactServices.update(sessionId, userId, artifactId, {
      content: {
        ...verification,
        studentResponse,
        passed: output.passed,
        score: output.score,
        feedback: output.feedback,
        verifiedAt: new Date(),
      } as never,
    });

    if (sessionId) {
      emitEvent(
        "session:verification_completed",
        userId,
        { type: "session", id: sessionId },
        { artifactId, passed: output.passed, score: output.score },
      );
    }

    return output;
  },
);

const verificationSkill: ISkill = {
  name: "verification",
  displayName: "Verification",
  description: "Create and evaluate verification exercises.",
  scope: "session",
  category: "verification",
  tools: [createVerificationTool, evaluateVerificationTool],
  phases: ["verification"],
  autoEquip: (s) => s.mode === "structured",
};

export default verificationSkill;
