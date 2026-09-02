import { Types } from "mongoose";
import { StudySession, SessionMemory, StudyPlan, CourseSummary, Task } from "./models";
import { applySearchFilters, IPaginationOptions } from "@/utils";
import { isValidObjectId } from "mongoose";
import type { AgentPhase } from "./interfaces";

// ─── Study plan selectors ───────────────────────────────────────────────────

export const getStudyPlanById = (id: string | Types.ObjectId) => {
  if (!isValidObjectId(id)) return null as any;
  return StudyPlan.findById(id).lean();
};

export const getStudyPlanBySession = (sessionId: string | Types.ObjectId) => {
  if (!isValidObjectId(sessionId)) return null as any;
  return StudyPlan.findOne({ sessionId: new Types.ObjectId(sessionId) }).lean();
};

export const getStudyPlansByUser = (
  userId: string | Types.ObjectId,
  options?: IPaginationOptions,
) => applySearchFilters(StudyPlan.find({ userId: new Types.ObjectId(userId) }).lean(), options);

export const getStudyPlansByCourse = (
  courseId: string | Types.ObjectId,
  options?: IPaginationOptions,
) => applySearchFilters(StudyPlan.find({ courseId: new Types.ObjectId(courseId) }).lean(), options);

// ─── Course summary selectors ────────────────────────────────────────────────

export const getCourseSummaryBySession = (sessionId: string | Types.ObjectId) => {
  if (!isValidObjectId(sessionId)) return null as any;
  return CourseSummary.findOne({ sessionId: new Types.ObjectId(sessionId) }).lean();
};

// ─── Study session selectors ──────────────────────────────────────────────────

export const getSessionById = (id: string | Types.ObjectId) => {
  if (!isValidObjectId(id)) return null as any;
  return StudySession.findById(id)
    .populate("studyPlan")
    .populate("courseSummary")
    .lean();
};

export const getSessionsByUser = (
  userId: string | Types.ObjectId,
  options?: IPaginationOptions,
) =>
  applySearchFilters(
    StudySession.find({ userId, isTransient: { $ne: true } })
      .populate("studyPlan")
      .populate("courseSummary")
      .lean(),
    options,
  );

export const getActiveSessionsByUser = (
  userId: string | Types.ObjectId,
  options?: IPaginationOptions,
) =>
  applySearchFilters(
    StudySession.find({ userId, status: "active", isTransient: { $ne: true } })
      .populate("studyPlan")
      .populate("courseSummary")
      .lean(),
    options,
  );

export const getSessionsByCourse = (
  courseId: string | Types.ObjectId,
  options?: IPaginationOptions,
) =>
  applySearchFilters(
    StudySession.find({ courseId })
      .populate("studyPlan")
      .populate("courseSummary")
      .lean(),
    options,
  );

export const getAllSessions = (options?: IPaginationOptions) =>
  applySearchFilters(
    StudySession.find()
      .populate("studyPlan")
      .populate("courseSummary")
      .lean(),
    options,
  );

export const getSessionByPhase = (
  userId: string | Types.ObjectId,
  phase: AgentPhase,
  options?: IPaginationOptions,
) =>
  applySearchFilters(
    StudySession.find({ userId, currentPhase: phase }).lean(),
    options,
  );

// ─── Session memory selectors ─────────────────────────────────────────────────

export const getMemoryByUser = (userId: string, courseId?: string) =>
  SessionMemory.findOne({ userId, courseId: courseId ?? null }).lean();

export const getAllMemoryByUser = (
  userId: string,
  options?: IPaginationOptions,
) =>
  // ISessionMemory does not extend Document; cast required for applySearchFilters
  applySearchFilters(SessionMemory.find({ userId }).lean() as any, options);

// ─── Study task selectors ──────────────────────────────────────────────────────

/**
 * options accepts a `status: "active" | "completed"` filter (applySearchFilters
 * passes any unrecognised key straight through to the query, see @/utils),
 * matching the UI's status toggle. Soft-deleted tasks are always excluded.
 */
export const getTasksByUser = (
  userId: string | Types.ObjectId,
  options?: IPaginationOptions,
) =>
  applySearchFilters(
    Task.find({
      userId: new Types.ObjectId(userId),
      isDeleted: { $ne: true },
    }).lean(),
    options,
  );
