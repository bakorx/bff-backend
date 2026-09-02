import type { Types } from "mongoose";
import type { IExamEntry, IVenueMapping } from "@/learning";

export type DashboardExamType = IExamEntry["examType"];
export type DashboardSessionMode = "free" | "structured";
export type DashboardSessionStatus =
  | "active"
  | "paused"
  | "completed"
  | "abandoned";

// ─── Payload contract (all dates are ISO strings — JSON-safe after Redis) ───

export interface IDashboardCourse {
  courseId: string;
  code: string;
  title: string;
  /** 0–100, how far along the enrolledAt → next-exam window we are; null when no upcoming exam */
  progressPercent: number | null;
  daysToExam: number | null;
  examDate: string | null;
  examType: DashboardExamType | null;
}

export interface IBriefSessions {
  count: number;
  totalMinutes: number;
}

export interface IBriefFlashcards {
  reviewedCount: number;
  averageMastery: number | null;
  weakCount: number;
}

export interface IBriefQuizzes {
  attemptedCount: number;
  averageScore: number | null;
}

export interface IBriefExams {
  upcomingCount: number;
  daysToNext: number | null;
}

export interface ITodaysBrief {
  /** ISO — start of the aggregation window ("since yesterday") */
  windowStart: string;
  sessions: IBriefSessions;
  flashcards: IBriefFlashcards;
  quizzes: IBriefQuizzes;
  exams: IBriefExams;
}

export interface INextExam {
  courseCode: string;
  courseName: string;
  examType: DashboardExamType;
  scheduledAt: string;
  daysLeft: number;
  /** Only when unambiguous (single venue on the session); null otherwise */
  venue: string | null;
}

export interface IRecentWorkItem {
  id: string;
  displayName: string;
  courseCode: string | null;
  courseTitle: string | null;
  mode: DashboardSessionMode;
  status: DashboardSessionStatus;
  updatedAt: string;
  messageCount: number;
}

export interface IDashboardPayload {
  /** Sorted soonest-exam-first; courses without upcoming exams come last */
  courses: IDashboardCourse[];
  todaysBrief: ITodaysBrief;
  nextExam: INextExam | null;
  /** Latest sessions by most recent activity */
  recentWork: IRecentWorkItem[];
  generatedAt: string;
}

export interface IDashboardResult {
  payload: IDashboardPayload;
  fromCache: boolean;
}

// ─── Pipeline row shapes ─────────────────────────────────────────────────────

/**
 * One enrollment joined to its course and its next upcoming exam (if any).
 * The aggregation sorts these soonest-exam-first, exam-less courses last.
 */
export interface ICourseRow {
  courseId: Types.ObjectId;
  code: string;
  title: string;
  enrolledAt: Date;
  examType: DashboardExamType | null;
  /** Next upcoming exam session for this course; null when none */
  examAt: Date | null;
}

export interface IUpcomingExamRow {
  courseId: Types.ObjectId;
  courseCode: string;
  courseName: string;
  examType: DashboardExamType;
  scheduledAt: Date;
  venues: IVenueMapping[];
}

export interface ISessionActivityRow {
  count: number;
  totalMinutes: number;
}

export interface IRecentSessionRow {
  id: Types.ObjectId;
  name: string;
  mode: DashboardSessionMode;
  status: DashboardSessionStatus;
  updatedAt: Date;
  messageCount: number;
  courseCode?: string;
  courseTitle?: string;
}

export interface IFlashcardActivityRow {
  reviewedCount: number;
  averageMastery: number | null;
  weakCount: number;
}

export interface IQuizActivityRow {
  attemptedCount: number;
  averageScore: number | null;
}
