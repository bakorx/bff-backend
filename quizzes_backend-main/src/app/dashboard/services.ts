import { Types } from "mongoose";
import {
  buildCacheKey,
  getCache,
  setCache,
  invalidateCache,
} from "@/utils";
import {
  Course,
  ExamTimetable,
  FlashcardSet,
  PersonalQuiz,
  UserCourseEnrollment,
} from "@/learning";
import { StudySession } from "../models";
import {
  ICourseRow,
  IDashboardCourse,
  IDashboardPayload,
  IDashboardResult,
  IFlashcardActivityRow,
  INextExam,
  IQuizActivityRow,
  IRecentSessionRow,
  IRecentWorkItem,
  ISessionActivityRow,
  ITodaysBrief,
  IUpcomingExamRow,
} from "./interfaces";

const DASHBOARD_CACHE_TTL_SECONDS = 3600; // 1 hour
const RECENT_WORK_LIMIT = 4;
const WEAK_MASTERY_THRESHOLD = 50;
const MS_PER_DAY = 86_400_000;

/** Session names the auto-renamer treats as placeholders — never shown verbatim */
const GENERIC_SESSION_NAMES = new Set([
  "New Study Session",
  "Revised Study Session",
]);

// ─── Window ──────────────────────────────────────────────────────────────────

/**
 * Start of yesterday (UTC). On Mondays we extend back to the previous Monday
 * 00:00 UTC so weekend activity is still included. Ghana is UTC year-round.
 */
function computeWindowStart(now: Date): Date {
  const startOfTodayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const daysBack = now.getUTCDay() === 1 ? 7 : 1;
  return new Date(startOfTodayUtc - daysBack * 24 * 60 * 60 * 1000);
}

// ─── Pipelines ───────────────────────────────────────────────────────────────

/**
 * Active enrollments joined to their (non-deleted) course and to the course's
 * next upcoming exam session. The next exam is resolved with a correlated
 * $lookup and the whole thing is sorted in the pipeline: courses with an
 * upcoming exam first (soonest first), then exam-less courses (most recently
 * enrolled first). No JS-side merge/sort needed.
 */
async function getCourseRows(
  userId: Types.ObjectId,
  now: Date,
): Promise<ICourseRow[]> {
  return UserCourseEnrollment.aggregate<ICourseRow>([
    { $match: { userId, status: "active" } },
    {
      $lookup: {
        from: Course.collection.name,
        localField: "courseId",
        foreignField: "_id",
        as: "course",
      },
    },
    { $unwind: "$course" },
    { $match: { "course.isDeleted": { $ne: true } } },
    {
      // Nearest future exam session for this course across published timetables.
      $lookup: {
        from: ExamTimetable.collection.name,
        let: { courseId: "$courseId", now },
        pipeline: [
          { $match: { isPublished: true } },
          { $unwind: "$entries" },
          { $match: { $expr: { $eq: ["$entries.courseId", "$$courseId"] } } },
          { $unwind: "$entries.sessions" },
          {
            $match: {
              $expr: { $gte: ["$entries.sessions.scheduledAt", "$$now"] },
            },
          },
          { $sort: { "entries.sessions.scheduledAt": 1 } },
          { $limit: 1 },
          {
            $project: {
              examType: "$entries.examType",
              scheduledAt: "$entries.sessions.scheduledAt",
            },
          },
        ],
        as: "nextExam",
      },
    },
    { $unwind: { path: "$nextExam", preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        examAt: "$nextExam.scheduledAt",
        // Sort key: 0 = has upcoming exam, 1 = none.
        _hasExam: {
          $cond: [{ $eq: [{ $ifNull: ["$nextExam.scheduledAt", null] }, null] }, 1, 0],
        },
      },
    },
    { $sort: { _hasExam: 1, examAt: 1, enrolledAt: -1 } },
    {
      $project: {
        courseId: 1,
        code: "$course.code",
        title: "$course.title",
        enrolledAt: 1,
        examType: "$nextExam.examType",
        examAt: 1,
      },
    },
  ]);
}

/**
 * All upcoming exam sessions across published timetables that contain the
 * user's enrolled courses. Mirrors getTimetablesForUser's visibility rules
 * (published timetables, entries filtered to enrolled courses) but is not
 * scoped to a semester — the dashboard surfaces everything upcoming.
 * Sorted soonest first.
 */
async function getUpcomingExamRows(
  courseIds: Types.ObjectId[],
  now: Date,
): Promise<IUpcomingExamRow[]> {
  if (courseIds.length === 0) return [];
  return ExamTimetable.aggregate<IUpcomingExamRow>([
    { $match: { isPublished: true, "entries.courseId": { $in: courseIds } } },
    { $unwind: "$entries" },
    { $match: { "entries.courseId": { $in: courseIds } } },
    { $unwind: "$entries.sessions" },
    { $match: { "entries.sessions.scheduledAt": { $gte: now } } },
    {
      $project: {
        courseId: "$entries.courseId",
        courseCode: "$entries.courseCode",
        courseName: "$entries.courseName",
        examType: "$entries.examType",
        scheduledAt: "$entries.sessions.scheduledAt",
        venues: "$entries.sessions.venues",
      },
    },
    { $sort: { scheduledAt: 1 } },
  ]);
}

/** Sessions touched within the brief window: count + total minutes. */
async function getSessionActivityRow(
  userId: Types.ObjectId,
  windowStart: Date,
): Promise<ISessionActivityRow | null> {
  const rows = await StudySession.aggregate<ISessionActivityRow>([
    {
      $match: {
        userId,
        isTransient: { $ne: true },
        updatedAt: { $gte: windowStart },
      },
    },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        // durationMinutes is not populated anywhere yet; fall back to
        // completedAt - startedAt for finished sessions.
        totalMinutes: {
          $sum: {
            $cond: [
              { $gt: [{ $ifNull: ["$durationMinutes", 0] }, 0] },
              "$durationMinutes",
              {
                $cond: [
                  {
                    $and: [
                      { $ne: ["$startedAt", null] },
                      { $ne: ["$completedAt", null] },
                    ],
                  },
                  {
                    $divide: [
                      { $subtract: ["$completedAt", "$startedAt"] },
                      60_000,
                    ],
                  },
                  0,
                ],
              },
            ],
          },
        },
      },
    },
  ]);
  return rows[0] ?? null;
}

/** Latest non-transient sessions by most recent activity, course joined. */
async function getRecentSessionRows(
  userId: Types.ObjectId,
): Promise<IRecentSessionRow[]> {
  return StudySession.aggregate<IRecentSessionRow>([
    { $match: { userId, isTransient: { $ne: true } } },
    { $sort: { updatedAt: -1 } },
    { $limit: RECENT_WORK_LIMIT },
    {
      $lookup: {
        from: Course.collection.name,
        localField: "courseId",
        foreignField: "_id",
        as: "course",
      },
    },
    { $unwind: { path: "$course", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        id: "$_id",
        name: 1,
        mode: 1,
        status: 1,
        updatedAt: { $ifNull: ["$updatedAt", "$createdAt"] },
        messageCount: { $size: { $ifNull: ["$messages", []] } },
        courseCode: "$course.code",
        courseTitle: "$course.title",
      },
    },
  ]);
}

/** Flashcard cards reviewed within the brief window (mastery stats). */
async function getFlashcardActivityRow(
  userId: Types.ObjectId,
  windowStart: Date,
): Promise<IFlashcardActivityRow | null> {
  const rows = await FlashcardSet.aggregate<IFlashcardActivityRow>([
    {
      $match: {
        createdBy: userId,
        isDeleted: { $ne: true },
        "cards.lastReviewed": { $gte: windowStart },
      },
    },
    { $unwind: "$cards" },
    { $match: { "cards.lastReviewed": { $gte: windowStart } } },
    {
      $group: {
        _id: null,
        reviewedCount: { $sum: 1 },
        averageMastery: { $avg: "$cards.masteryLevel" },
        weakCount: {
          $sum: {
            $cond: [{ $lt: ["$cards.masteryLevel", WEAK_MASTERY_THRESHOLD] }, 1, 0],
          },
        },
      },
    },
  ]);
  return rows[0] ?? null;
}

/** Personal quizzes attempted within the brief window. */
async function getQuizActivityRow(
  userId: Types.ObjectId,
  windowStart: Date,
): Promise<IQuizActivityRow | null> {
  const rows = await PersonalQuiz.aggregate<IQuizActivityRow>([
    {
      $match: {
        createdBy: userId,
        isDeleted: { $ne: true },
        "stats.lastAttempted": { $gte: windowStart },
      },
    },
    {
      $group: {
        _id: null,
        attemptedCount: { $sum: 1 },
        averageScore: { $avg: "$stats.averageScore" },
      },
    },
  ]);
  return rows[0] ?? null;
}

// ─── Assembly helpers ────────────────────────────────────────────────────────

function daysUntil(target: Date, now: Date): number {
  return Math.ceil((target.getTime() - now.getTime()) / MS_PER_DAY);
}

/** Progress = elapsed / total of the enrolledAt → exam window, clamped 0–100. */
function computeProgressPercent(
  now: Date,
  enrolledAt: Date,
  examAt: Date,
): number | null {
  const total = examAt.getTime() - enrolledAt.getTime();
  if (total <= 0) return null;
  const elapsed = now.getTime() - enrolledAt.getTime();
  return Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
}

/** Real session name unless it's a generic placeholder. */
function sessionDisplayName(
  name: string | undefined,
  courseCode: string | null | undefined,
): string {
  const trimmed = name?.trim();
  if (trimmed && !GENERIC_SESSION_NAMES.has(trimmed)) return trimmed;
  return courseCode ? `${courseCode} session` : "Study session";
}

// ─── Payload builder ─────────────────────────────────────────────────────────

async function buildDashboardPayload(
  userId: string,
): Promise<IDashboardPayload> {
  const userOid = new Types.ObjectId(userId);
  const now = new Date();
  const windowStart = computeWindowStart(now);

  // Course rows first — the global exam pipeline needs their courseIds.
  const courseRows = await getCourseRows(userOid, now);
  const courseIds = courseRows.map((c) => c.courseId);

  const [examRows, sessionActivity, recentSessions, flashcardActivity, quizActivity] =
    await Promise.all([
      getUpcomingExamRows(courseIds, now),
      getSessionActivityRow(userOid, windowStart),
      getRecentSessionRows(userOid),
      getFlashcardActivityRow(userOid, windowStart),
      getQuizActivityRow(userOid, windowStart),
    ]);

  // Course rows arrive pre-sorted from the pipeline: soonest-exam first,
  // exam-less courses last.
  const courses: IDashboardCourse[] = courseRows.map((row) => ({
    courseId: String(row.courseId),
    code: row.code,
    title: row.title,
    progressPercent: row.examAt
      ? computeProgressPercent(now, row.enrolledAt, row.examAt)
      : null,
    daysToExam: row.examAt ? daysUntil(row.examAt, now) : null,
    examDate: row.examAt ? row.examAt.toISOString() : null,
    examType: row.examAt ? row.examType ?? null : null,
  }));

  const firstExam = examRows[0] ?? null;
  const nextExam: INextExam | null = firstExam
    ? {
        courseCode: firstExam.courseCode,
        courseName: firstExam.courseName,
        examType: firstExam.examType,
        scheduledAt: firstExam.scheduledAt.toISOString(),
        daysLeft: daysUntil(firstExam.scheduledAt, now),
        venue:
          firstExam.venues.length === 1 ? firstExam.venues[0].venue : null,
      }
    : null;

  const todaysBrief: ITodaysBrief = {
    windowStart: windowStart.toISOString(),
    sessions: {
      count: sessionActivity?.count ?? 0,
      totalMinutes: Math.round(sessionActivity?.totalMinutes ?? 0),
    },
    flashcards: {
      reviewedCount: flashcardActivity?.reviewedCount ?? 0,
      averageMastery:
        flashcardActivity &&
        flashcardActivity.reviewedCount > 0 &&
        flashcardActivity.averageMastery != null
          ? Math.round(flashcardActivity.averageMastery)
          : null,
      weakCount: flashcardActivity?.weakCount ?? 0,
    },
    quizzes: {
      attemptedCount: quizActivity?.attemptedCount ?? 0,
      averageScore:
        quizActivity &&
        quizActivity.attemptedCount > 0 &&
        quizActivity.averageScore != null
          ? Math.round(quizActivity.averageScore)
          : null,
    },
    exams: {
      upcomingCount: examRows.length,
      daysToNext: firstExam ? daysUntil(firstExam.scheduledAt, now) : null,
    },
  };

  const recentWork: IRecentWorkItem[] = recentSessions.map((session) => ({
    id: String(session.id),
    displayName: sessionDisplayName(session.name, session.courseCode),
    courseCode: session.courseCode ?? null,
    courseTitle: session.courseTitle ?? null,
    mode: session.mode,
    status: session.status,
    updatedAt: session.updatedAt.toISOString(),
    messageCount: session.messageCount,
  }));

  return {
    courses,
    todaysBrief,
    nextExam,
    recentWork,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Cache Helpers ──────────────────────────────────────────────────────────

export const dashboardCacheKey = (userId: string | Types.ObjectId): string =>
  buildCacheKey("dashboard", String(userId));

export const invalidateDashboardCache = async (
  userId: string | Types.ObjectId | null | undefined,
): Promise<void> => {
  if (!userId) return;
  await invalidateCache(dashboardCacheKey(userId));
};

// ─── Entry point ─────────────────────────────────────────────────────────────

export const getDashboardForUser = async (
  userId: string,
): Promise<IDashboardResult> => {
  const key = dashboardCacheKey(userId);

  const cached = await getCache<IDashboardPayload>(key);
  if (cached) return { payload: cached, fromCache: true };

  const payload = await buildDashboardPayload(userId);
  await setCache(key, payload, DASHBOARD_CACHE_TTL_SECONDS);
  return { payload, fromCache: false };
};

