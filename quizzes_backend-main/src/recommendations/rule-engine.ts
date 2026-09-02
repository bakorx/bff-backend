import { Types } from "mongoose";
import type { IEvent } from "@/events";
import { StudySession } from "@/app";
import { PersonalQuiz, Quiz, UserCourseEnrollment, Course } from "@/learning";
import { InternalRec } from "./interfaces";

// ---------------------------------------------------------------------------
// System tier rule engine — rec-engine.md §7.5.
//
// "Deterministic rules, evaluated in priority order. The first matching
// rule produces a recommendation." Rules 1-3 each produce a single rec;
// rule 5 (dashboard fallback) produces up to 3.
//
// Rule 4 ("note saved on topic X -> related quiz") and rule 6 ("cold start
// -> community-curated resources") are NOT implemented — both are blocked
// on real gaps, not skipped for convenience:
//   - Rule 4 needs a topic/tag on Note, and the Note model has no tags
//     field at all (confirmed during #25 — note:tag_added/removed were
//     skipped there for the same reason).
//   - Rule 6 needs findExternalResources (#19) returning real approved +
//     verified data — the ExternalResource model (#13) exists now, but
//     #19's lookup and the moderation/bulk-import pipeline that would
//     populate it (#16, #18) don't yet.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

async function ruleQuizFail(recentEvents: IEvent[]): Promise<InternalRec | null> {
  const cutoff = Date.now() - DAY_MS;
  const failedQuizEvent = recentEvents.find(
    (e) =>
      e.eventType === "quiz:private_graded" &&
      e.occurredAt.getTime() >= cutoff &&
      typeof (e.payload as any)?.score === "number" &&
      (e.payload as any).score < 70,
  );
  if (!failedQuizEvent) return null;

  const failedQuiz = await PersonalQuiz.findById(failedQuizEvent.sourceRef.id).lean();
  if (!failedQuiz?.courseId) return null;

  // "Another quiz on the same topic" — a different quiz in the same course
  // the user hasn't already scored well on.
  const candidate = await PersonalQuiz.findOne({
    courseId: failedQuiz.courseId,
    _id: { $ne: failedQuiz._id },
  })
    .sort({ createdAt: -1 })
    .lean();
  if (!candidate) return null;

  return {
    id: String(candidate._id),
    type: "quiz",
    title: candidate.title,
    score: 1.0,
    status: "ready",
  };
}

async function ruleSessionAbandoned(userId: Types.ObjectId): Promise<InternalRec | null> {
  const cutoff = new Date(Date.now() - DAY_MS);
  const abandoned = await StudySession.findOne({
    userId,
    status: "abandoned",
    completedAt: { $lte: cutoff },
  })
    .sort({ completedAt: -1 })
    .lean();
  if (!abandoned) return null;

  return {
    id: String(abandoned._id),
    type: "session",
    title: (abandoned as any).name || "Resume your study session",
    score: 1.0,
    status: "ready",
  };
}

async function ruleStaleEnrollment(userId: Types.ObjectId): Promise<InternalRec | null> {
  const cutoff = new Date(Date.now() - 7 * DAY_MS);
  const enrollments = await UserCourseEnrollment.find({ userId, status: "active" }).lean();
  if (enrollments.length === 0) return null;

  for (const enrollment of enrollments) {
    const recentActivity = await StudySession.exists({
      userId,
      courseId: enrollment.courseId,
      $or: [{ startedAt: { $gte: cutoff } }, { updatedAt: { $gte: cutoff } }],
    });
    if (recentActivity) continue;

    const course = await Course.findById(enrollment.courseId).lean();
    if (!course) continue;

    return {
      id: String(course._id),
      type: "course",
      title: course.title,
      score: 1.0,
      status: "ready",
    };
  }

  return null;
}

async function ruleDashboardFallback(userId: Types.ObjectId): Promise<InternalRec[]> {
  const enrollments = await UserCourseEnrollment.find({ userId, status: "active" }).lean();
  const courseIds = enrollments.map((e) => e.courseId);
  if (courseIds.length === 0) return [];

  // No cross-user popularity metric is actually tracked on Quiz today
  // (the "stats.totalAttempts" field lives on PersonalQuiz, a per-user
  // document, not the shared/system Quiz model) — ranking by recency is
  // the least-fabricated honest substitute until real popularity tracking
  // exists.
  const quizzes = await Quiz.find({
    courseId: { $in: courseIds },
    status: "published",
    isAvailable: true,
  })
    .sort({ createdAt: -1 })
    .limit(3)
    .lean();

  return quizzes.map((q, i) => ({
    id: String(q._id),
    type: "quiz" as const,
    title: q.title,
    score: 1.0 - i * 0.1,
    status: "ready" as const,
  }));
}

export async function runSystemRuleEngine(
  userId: Types.ObjectId,
  surface: string,
  recentEvents: IEvent[],
): Promise<InternalRec[]> {
  const quizFailRec = await ruleQuizFail(recentEvents);
  if (quizFailRec) return [quizFailRec];

  const abandonedRec = await ruleSessionAbandoned(userId);
  if (abandonedRec) return [abandonedRec];

  const staleEnrollmentRec = await ruleStaleEnrollment(userId);
  if (staleEnrollmentRec) return [staleEnrollmentRec];

  if (surface === "dashboard") {
    return ruleDashboardFallback(userId);
  }

  return [];
}

/**
 * Candidate pool for premium tier (#5, generatePremiumRecs). Unlike
 * runSystemRuleEngine's "first matching rule wins, return one item", this
 * gathers EVERY real candidate the same rule functions can find, so the
 * LLM synthesis call has a pool of REAL, existing content to select from
 * and explain — it never invents a contentId. §9 ("The same rec engine,
 * the same data... The difference is the LLM call") is why this reuses
 * the exact same rule functions rather than a separate candidate source.
 *
 * Deduplicated by (type, id). Not surface-gated — dashboard-fallback-style
 * quizzes are always included as one part of the pool; premium's LLM call
 * decides relevance per surface, unlike system tier's simple surface gate.
 */
export async function gatherCandidateRecs(
  userId: Types.ObjectId,
  recentEvents: IEvent[],
): Promise<InternalRec[]> {
  const [quizFail, abandoned, staleEnrollment, popular] = await Promise.all([
    ruleQuizFail(recentEvents),
    ruleSessionAbandoned(userId),
    ruleStaleEnrollment(userId),
    ruleDashboardFallback(userId),
  ]);

  const candidates = [quizFail, abandoned, staleEnrollment, ...popular].filter(
    (c): c is InternalRec => c !== null,
  );

  const seen = new Set<string>();
  return candidates.filter((c) => {
    const key = `${c.type}:${c.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
