import { z } from "genkit";
import { ai } from "@/ai/config";
import { ISkill } from "../interfaces";
import { MemoryServices } from "../../memory/services";
import { StudySession } from "../../models";
import { defineToolOnce, resolveSkillContext } from "../tool-context";
import { emit as emitEvent } from "@/events/services";

const readMemoryTool = defineToolOnce(
  {
    name: "read_memory",
    description:
      "Read the student memory (known concepts, gaps, mastered goals, study patterns).",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      courseId: z.string().optional(),
    }),
  },
  async (input) => {
    const { userId, courseId } = await resolveSkillContext(input);
    if (!userId)
      throw new Error("userId or sessionId is required for read_memory");
    return MemoryServices.snapshot(userId, courseId);
  },
);

const updateMemoryTool = defineToolOnce(
  {
    name: "update_memory",
    description:
      "Update the student memory — add known concepts, gaps, or mastered goals.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      courseId: z.string().optional(),
      addKnownConcepts: z.array(z.string()).optional(),
      addGaps: z.array(z.string()).optional(),
      removeGaps: z.array(z.string()).optional(),
      addMasteredGoals: z.array(z.string()).optional(),
    }),
  },
  async (input) => {
    const { addKnownConcepts, addGaps, removeGaps, addMasteredGoals } = input;
    const { userId, courseId } = await resolveSkillContext(input);
    if (!userId)
      throw new Error("userId or sessionId is required for update_memory");
    const memory = await MemoryServices.update(userId, courseId, {
      addKnownConcepts,
      addGaps,
      removeGaps,
      addMasteredGoals,
    });

    if (memory) {
      emitEvent(
        "session:memory_artifact_saved",
        userId,
        { type: "session_memory", id: memory._id },
        { courseId, addedConcepts: addKnownConcepts?.length ?? 0 },
      );
    }

    return { updated: true };
  },
);

const memorySkill: ISkill = {
  name: "memory",
  displayName: "Memory",
  description: "Read and update student memory across sessions.",
  scope: "global",
  category: "utility",
  tools: [readMemoryTool, updateMemoryTool],
  phases: [],
};

export default memorySkill;
