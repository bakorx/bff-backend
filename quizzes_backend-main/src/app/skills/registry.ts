import { ISkill } from "./interfaces";
import { IStudySession, AgentPhase } from "../interfaces";

import memorySkill from "./global/memory.skill";
import citationSkill from "./global/citation.skill";
import studioSkill from "./global/studio.skill";
import steeringSkill from "./global/steering.skill";
import phaseSkill from "./global/phase.skill";

import syllabusResearchSkill from "./session/syllabus_research.skill";
import studyPlanSkill from "./session/study_plan.skill";
import expositionSkill from "./session/exposition.skill";
import examSimulatorSkill from "./session/exam_simulator.skill";
import courseSummarySkill from "./session/course_summary.skill";
import lessonSkill from "./session/lesson.skill";
import flashcardSkill from "./session/flashcard.skill";
import quizSkill from "./session/quiz.skill";
import mindmapSkill from "./session/mindmap.skill";
import verificationSkill from "./session/verification.skill";
import walkthroughSkill from "./session/walkthrough.skill";
import notesSkill from "./session/notes.skill";

export const GLOBAL_SKILLS: ISkill[] = [
  memorySkill,
  citationSkill,
  studioSkill,
  steeringSkill,
  phaseSkill,
];

export const SESSION_SKILLS: ISkill[] = [
  studyPlanSkill,
  expositionSkill,
  examSimulatorSkill,
  courseSummarySkill,
  syllabusResearchSkill,
  lessonSkill,
  flashcardSkill,
  quizSkill,
  mindmapSkill,
  verificationSkill,
  walkthroughSkill,
  notesSkill,
];

export const ALL_SKILLS: ISkill[] = [...GLOBAL_SKILLS, ...SESSION_SKILLS];

export function resolveSkills(session: IStudySession): ISkill[] {
  const equipped = new Set(session.equippedSkills);
  const resolved: ISkill[] = [...GLOBAL_SKILLS];

  for (const skill of SESSION_SKILLS) {
    if (equipped.has(skill.name) || skill.autoEquip?.(session)) {
      resolved.push(skill);
    }
  }

  return resolved;
}

export function buildToolsForPhase(skills: ISkill[], phase: AgentPhase): unknown[] {
  return skills
    .filter((s) => s.phases.includes(phase) || s.phases.length === 0)
    .flatMap((s) => s.tools);
}
