import { z } from "genkit";
import { ai } from "@/ai/config";
import { defineToolOnce, resolveSkillContext } from "../tool-context";
import { ISkill } from "../../interfaces";
import { StudySession } from "../../models";
import { runInTransaction } from "@/utils";
import {publishers} from "@/socket/publishers";
import { AgentPhase } from "../../interfaces";
import { isValidObjectId } from "mongoose";
import { logger } from "@/config";
import { emit as emitEvent } from "@/events/services";

// Hardcoded to avoid circular dependency with registry
const SESSION_SKILL_NAMES = [
  "syllabus_research",
  "lesson",
  "flashcard",
  "quiz",
  "mindmap",
  "verification",
  "walkthrough",
];

const transitionPhaseTool = defineToolOnce(
  {
    name: "transition_phase",
    description: "Transition the session to a new phase.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      newPhase: z.string(),
    }),
  },
  async (input) => {
    const { newPhase } = input;
    const { sessionId, userId } = await resolveSkillContext(input);

    if (sessionId && !isValidObjectId(sessionId)) {
      logger.info(
        `[transition_phase] Ignoring invalid sessionId: ${sessionId}`,
      );
      return { phase: newPhase, skipped: true };
    }

    let previousPhase: string | undefined;

    if (sessionId) {
      const existingSession = await StudySession.findById(sessionId)
        .select("currentPhase")
        .lean();
      if (!existingSession) {
        throw new Error("Session not found");
      }

      if (existingSession.currentPhase === (newPhase as AgentPhase)) {
        return { phase: newPhase, skipped: true };
      }

      previousPhase = existingSession.currentPhase;

      await runInTransaction(async (txSession) => {
        const sess = await StudySession.findById(sessionId)
          .select("currentPhase previousPhase")
          .session(txSession);
        if (!sess) throw new Error("Session not found");

        if (sess.currentPhase === (newPhase as AgentPhase)) return;

        sess.previousPhase = sess.currentPhase;
        sess.currentPhase = newPhase as AgentPhase;
        await sess.save({ session: txSession });
      });
    }

    if (sessionId && userId) {
      publishers.appSignal(sessionId, userId, {
        type: "phase_changed",
        payload: { newPhase, timestamp: new Date() },
        timestamp: new Date(),
      });

      emitEvent(
        "session:phase_changed",
        userId,
        { type: "session", id: sessionId },
        { newPhase, previousPhase },
      );

      // The AI signs off a session by transitioning to "complete" — there's
      // no separate "session finished" bookkeeping anywhere else in the
      // codebase. Note: StudySession.status is never actually set to
      // "completed" when this happens (pre-existing gap, unrelated to event
      // wiring — status stays "active" even for finished sessions).
      if (newPhase === "complete") {
        emitEvent(
          "session:finished",
          userId,
          { type: "session", id: sessionId },
          { previousPhase },
        );
      }
    }
    return { phase: newPhase };
  },
);

const getPhaseTool = defineToolOnce(
  {
    name: "get_phase",
    description: "Get the current phase and goal context of the session.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
    }),
  },
  async (input) => {
    const { sessionId } = await resolveSkillContext(input);
    if (!sessionId) {
      return {
        currentPhase: "analysis",
        previousPhase: "initial",
        currentGoalId: undefined,
      };
    }
    if (!isValidObjectId(sessionId)) {
      logger.info(`[get_phase] Ignoring invalid sessionId: ${sessionId}`);
      return {
        currentPhase: "analysis",
        previousPhase: "initial",
        currentGoalId: undefined,
      };
    }
    const session = await StudySession.findById(sessionId).lean();
    if (!session) throw new Error("Session not found");
    return {
      currentPhase: session.currentPhase,
      previousPhase: session.previousPhase,
      currentGoalId: session.currentGoalId,
    };
  },
);

const equipSkillTool = defineToolOnce(
  {
    name: "equip_skill",
    description: "Equip a session skill for use in subsequent phases.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      skillName: z.string(),
    }),
  },
  async (input) => {
    const { skillName } = input;
    const { sessionId } = await resolveSkillContext(input);
    if (!SESSION_SKILL_NAMES.includes(skillName)) {
      // Silently succeed for unknown skill names — the AI should not narrate internal tool failures to the user
      return { equipped: true, skillName };
    }
    if (sessionId && !isValidObjectId(sessionId)) {
      logger.info(`[equip_skill] Ignoring invalid sessionId: ${sessionId}`);
      return { equipped: true, skillName, skipped: true };
    }
    if (sessionId) {
      await runInTransaction(async (txSession) => {
        const result = await StudySession.findOneAndUpdate(
          {
            _id: sessionId,
            equippedSkills: { $ne: skillName },
          },
          { $addToSet: { equippedSkills: skillName } },
          { session: txSession, returnDocument: "before" },
        );

        if (!result) {
          return;
        }
      });
    }
    return { equipped: true, skillName };
  },
);

const setGoalStatusTool = defineToolOnce(
  {
    name: "set_goal_status",
    description:
      "Update the status of a goal in the session. Call with status='active' when starting a goal and status='completed' when done. Optionally attach an artifactId produced for this goal.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      goalId: z.string(),
      status: z.enum(["pending", "active", "completed", "skipped"]),
      artifactId: z.string().optional(),
    }),
  },
  async (input) => {
    const { goalId, status, artifactId } = input;
    const { sessionId } = await resolveSkillContext(input);

    if (!sessionId || !isValidObjectId(sessionId)) {
      return { updated: false, reason: "no_session" };
    }

    const now = new Date();
    const statusUpdate: Record<string, unknown> = {
      "goals.$.status": status,
    };
    if (status === "active") {
      statusUpdate["goals.$.startedAt"] = now;
      // When activating a goal, set it as the session's currentGoalId
    }
    if (status === "completed" || status === "skipped") {
      statusUpdate["goals.$.completedAt"] = now;
    }

    await runInTransaction(async (txSession) => {
      await StudySession.findOneAndUpdate(
        { _id: sessionId, "goals.goalId": goalId },
        { $set: statusUpdate },
        { session: txSession },
      );

      if (status === "active") {
        await StudySession.findByIdAndUpdate(
          sessionId,
          { $set: { currentGoalId: goalId } },
          { session: txSession },
        );
      }

      if (artifactId) {
        await StudySession.findOneAndUpdate(
          { _id: sessionId, "goals.goalId": goalId },
          { $addToSet: { "goals.$.artifactIds": artifactId } },
          { session: txSession },
        );
      }
    });

    return { updated: true, goalId, status };
  },
);

const phaseSkill: ISkill = {
  name: "phase",
  displayName: "Phase",
  description:
    "Transition phases, check current phase, equip skills, and track goal status.",
  scope: "global",
  category: "utility",
  tools: [transitionPhaseTool, getPhaseTool, equipSkillTool, setGoalStatusTool],
  phases: [],
};

export default phaseSkill;
