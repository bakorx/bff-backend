import { logger, redisConnection } from "@/config";
import { resolveUserTier } from "@/events/services";
import { getRecommendationSet } from "@/recommendations/services";
import { publishers } from "@/socket/publishers";

// ---------------------------------------------------------------------------
// In-session recommendation trigger (#9) — rec-engine.md §10.
//
// NOT WIRED TO ANY REAL CALL SITE. This module implements the real
// counting/rate-limit/push mechanism §10 describes, as a standalone,
// independently-testable function — but nothing in the codebase currently
// calls it, because no real per-question, concept-tagged, real-time
// "wrong answer" signal exists to call it with. Investigated three
// candidates before concluding this:
//   1. Personal quiz bank grading (ai:grade_quiz_answers) — grades a whole
//      submitted quiz at once, not per-question as the user answers.
//   2. Session quiz skill's evaluate_answers tool
//      (src/app/skills/session/quiz.skill.ts) — also a BATCH tool: takes an
//      array of answers, grades them all in one call, returns an aggregate
//      {score, passed, feedback, wrongAnswers}. No incremental per-question
//      signal as the session progresses.
//   3. verification.skill.ts's evaluateVerificationTool — a genuine
//      per-attempt real-time signal (already wired to emit the real
//      session:verification_completed event), but its payload
//      {artifactId, passed, score} carries no concept/topic field to group
//      wrong attempts by, which §10's "same concept" trigger requires.
//
// Once a real per-question wrong-answer signal with a concept/topic tag
// exists, wire it in by calling evaluateInSessionTrigger() from that event's
// handler with the concept it graded against.
// ---------------------------------------------------------------------------

const WINDOW_MS = 10 * 60 * 1000; // §10: "within a 10-minute window"
const WINDOW_SECONDS = WINDOW_MS / 1000;
const REQUIRED_WRONG_ATTEMPTS = 2; // §10: "≥2 wrong attempts"
// Bounds how long a session's "already fired" marker lives in Redis. No
// explicit session-end event exists to clear it on, so it's TTL'd instead;
// 6h comfortably outlives any real study session.
const FIRED_TTL_SECONDS = 6 * 60 * 60;

function windowKey(sessionId: string, concept: string): string {
  return `rec:in_session:wrong:${sessionId}:${concept}`;
}

function firedKey(sessionId: string): string {
  return `rec:in_session:fired:${sessionId}`;
}

/**
 * Records one wrong attempt on `concept` within `sessionId`, and fires an
 * in-session recommendation if this attempt is the one that satisfies §10's
 * trigger (≥2 wrong attempts on the same concept within a 10-minute window)
 * — subject to the tier gate and the "max 1 per session, across all tiers"
 * rate limit.
 *
 * Deliberately uses a Redis sorted set (ZADD/ZCARD over a pruned window)
 * rather than the doc's literally-mentioned HINCRBY: a plain counter can't
 * express a *sliding* time window on its own (it would need a second key
 * and a reset job just to expire old attempts), whereas a per-attempt
 * timestamp in a sorted set lets ZREMRANGEBYSCORE prune anything older than
 * 10 minutes directly, and the remaining cardinality is the true window
 * count. Same doc-mandated behavior, no separate expiry sweep needed.
 *
 * Returns true if an in-session recommendation was fired, false otherwise
 * (below threshold, outside window, already fired this session, wrong
 * tier, or lost a race to a concurrent call for the same session).
 *
 * Never throws — mirrors emit()'s and flagForDelayedRec()'s
 * fire-and-forget-on-error contract; a Redis hiccup here should never take
 * down the caller's real request/grading path.
 */
export async function evaluateInSessionTrigger(
  sessionId: string,
  userId: string,
  concept: string,
): Promise<boolean> {
  try {
    // §10: "Free and cooked tiers only." Checked first so paid-tier session
    // traffic never touches Redis for this at all.
    const tier = await resolveUserTier(userId);
    if (tier !== "free" && tier !== "cooked") {
      return false;
    }

    const wKey = windowKey(sessionId, concept);
    const now = Date.now();
    const cutoff = now - WINDOW_MS;

    // Member must be unique per attempt for ZADD to actually accumulate
    // entries rather than overwrite one — timestamp alone can collide under
    // rapid-fire test input, so a random suffix is appended.
    const member = `${now}:${Math.random().toString(36).slice(2)}`;
    await redisConnection.zadd(wKey, now, member);
    await redisConnection.zremrangebyscore(wKey, 0, cutoff);
    await redisConnection.expire(wKey, WINDOW_SECONDS);

    const countInWindow = await redisConnection.zcard(wKey);
    if (countInWindow < REQUIRED_WRONG_ATTEMPTS) {
      return false;
    }

    // §10: "already fired this session?" gate, and separately "max 1
    // in-session recommendation per session... across all tiers." SET NX
    // both checks and claims atomically, so two concurrent calls for the
    // same session can't both win.
    const claimed = await redisConnection.set(
      firedKey(sessionId),
      "1",
      "EX",
      FIRED_TTL_SECONDS,
      "NX",
    );
    if (claimed !== "OK") {
      return false;
    }

    const recSet = await getRecommendationSet(userId, "in_session");
    publishers.recInSession({ userId, sessionId, concept, recSet });
    return true;
  } catch (err: any) {
    logger.error(
      `[in-session-trigger] failed for session ${sessionId}, concept ${concept}: ${err?.message ?? err}`,
    );
    return false;
  }
}
