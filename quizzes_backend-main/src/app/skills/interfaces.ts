import { z } from "genkit";
import { AgentPhase, IStudySession } from "../interfaces";

export const SkillContextSchema = z.object({
  sessionId: z.string().optional(),
  userId: z.string().optional(),
  courseId: z.string().optional(),
  chatId: z.string().optional(),
  materialIds: z.array(z.string()).optional(),
});

export type SkillContext = z.infer<typeof SkillContextSchema>;

export const BaseSkillInputSchema = z.object({
  sessionId: z.string().optional(), // for backward compatibility
  userId: z.string().optional(),
  courseId: z.string().optional(),
});

export type BaseSkillInput = z.infer<typeof BaseSkillInputSchema>;

export type SkillScope = "global" | "session";
export type SkillCategory =
  | "analysis"
  | "planning"
  | "implementation"
  | "verification"
  | "signoff"
  | "utility";

export interface ISkill {
  name: string;
  displayName: string;
  description: string;
  scope: SkillScope;
  category: SkillCategory;
  tools: any[]; // Genkit ToolAction — typed as any here, generic at call site
  phases: AgentPhase[];
  autoEquip?: (session: IStudySession) => boolean;
}
