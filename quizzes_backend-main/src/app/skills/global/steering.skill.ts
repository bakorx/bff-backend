import { z } from "genkit";
import { ai } from "@/ai/config";
import { defineToolOnce, resolveSkillContext } from "../tool-context";
import { ISkill } from "../interfaces";
import { StudySession } from "../../models";
import { runInTransaction } from "@/utils";

const checkInterruptTool = defineToolOnce(
  {
    name: "check_interrupt",
    description:
      "Check if a steering interrupt has been set for the current session.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
    }),
  },
  async (input) => {
    const { sessionId } = await resolveSkillContext(input);
    if (!sessionId) return { hasInterrupt: false };
    const session = await StudySession.findById(sessionId).lean();
    if (!session) throw new Error("Session not found");
    if (!session.interruptState) return { hasInterrupt: false };
    return {
      hasInterrupt: true,
      instruction: session.interruptState.pendingInstruction,
      resumeFrom: session.interruptState.resumeFrom,
    };
  },
);

const acknowledgeSteerTool = defineToolOnce(
  {
    name: "acknowledge_steer",
    description:
      "Clear the steering interrupt after processing the instruction.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
    }),
  },
  async (input) => {
    const { sessionId } = await resolveSkillContext(input);
    if (sessionId) {
      await runInTransaction(async (txSession) => {
        await StudySession.findByIdAndUpdate(
          sessionId,
          { $unset: { interruptState: 1 } },
          { session: txSession },
        );
      });
    }
    return { acknowledged: true };
  },
);

const steeringSkill: ISkill = {
  name: "steering",
  displayName: "Steering",
  description: "Check and acknowledge steering interrupts from the student.",
  scope: "global",
  category: "utility",
  tools: [checkInterruptTool, acknowledgeSteerTool],
  phases: [],
};

export default steeringSkill;
