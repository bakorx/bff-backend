import { Types } from "mongoose";
import {
  ILearnerProfile,
  ITopicAffinity,
  IRecommendedItem,
  RecommendationStrategy,
} from "./interfaces";
import { RECOMMENDATION_WEIGHTS } from "./constants";
import { RecommendationContentType } from "@/learning";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Computes a tag-overlap score (0–1) between a content item's tags and the
 * user's topic affinities.
 *
 * Each matching tag contributes its affinity score (0–1), then the result is
 * normalised so the maximum possible score is 1.  Tags that belong to an
 * explicitly followed topic get a 1.5× multiplier.
 */
export function computeTagOverlap(
  contentTags: string[],
  affinities: ITopicAffinity[]
): number {
  if (contentTags.length === 0 || affinities.length === 0) return 0;

  const affinityMap = new Map<string, ITopicAffinity>();
  for (const a of affinities) affinityMap.set(a.tag.toLowerCase(), a);

  let raw = 0;
  for (const tag of contentTags) {
    const aff = affinityMap.get(tag.toLowerCase());
    if (!aff) continue;
    const multiplier = aff.isFollowed ? 1.5 : 1.0;
    raw += aff.score * multiplier;
  }

  // Normalise: max possible raw = contentTags.length * 1.5 (all followed, score = 1)
  const maxRaw = contentTags.length * 1.5;
  return Math.min(raw / maxRaw, 1);
}

/**
 * Returns a recency bonus in [0, 1] based on how recently the content was
 * published relative to a 90-day window.  Content older than 90 days gets 0.
 */
export function computeRecencyBonus(publishedAt?: Date): number {
  if (!publishedAt) return 0;
  const ageMs = Date.now() - publishedAt.getTime();
  const windowMs = 90 * 24 * 60 * 60 * 1000;
  return Math.max(0, 1 - ageMs / windowMs);
}

/**
 * Decays an affinity score using a 30-day half-life exponential model.
 * Useful when updating a profile outside a full rebuild.
 */
export function decayAffinityScore(score: number, lastUpdated: Date): number {
  const ageMs = Date.now() - lastUpdated.getTime();
  const halfLifeMs = 30 * 24 * 60 * 60 * 1000;
  return score * Math.pow(0.5, ageMs / halfLifeMs);
}

// ---------------------------------------------------------------------------
// Candidate scoring
// ---------------------------------------------------------------------------

export interface ScoringContext {
  profile: ILearnerProfile;
  /** Tags attached to this candidate content item. */
  contentTags: string[];
  /** Publication date of the candidate (optional). */
  publishedAt?: Date;
  /** Popularity ratio [0,1] among same-university peers. */
  peerPopularity?: number;
  /** Peer similarity score [0,1] — how similar engaging peers are to this user. */
  peerSimilarity?: number;
  /** Whether the user has a low quiz score (<40) related to this content. */
  hasLowScore?: boolean;
  /** Whether the content directly targets one of the user's weak areas. */
  targetsWeakArea?: boolean;
  /** Whether the content is the logical next step after recently completed content. */
  isProgressionStep?: boolean;
}

/**
 * Computes a blended recommendation score in [0, 1] for a single candidate.
 *
 * Content in the user's dismissed, completed, or abandoned lists is handled
 * by the calling code (filter before scoring to avoid wasted CPU).
 */
export function scoreCandidate(ctx: ScoringContext): number {
  const w = RECOMMENDATION_WEIGHTS;
  let score = 0;

  // Content-based signals
  const tagScore = computeTagOverlap(ctx.contentTags, ctx.profile.topicAffinities);
  score += tagScore * w.topicAffinityMatch;

  // Followed topic bonus (already baked into tag overlap via 1.5× multiplier,
  // but we add an explicit additive bonus if any followed topic matched)
  const hasFollowedMatch = ctx.contentTags.some((tag) =>
    ctx.profile.topicAffinities.some(
      (a) => a.isFollowed && a.tag.toLowerCase() === tag.toLowerCase()
    )
  );
  if (hasFollowedMatch) score += w.followedTopicBonus;

  // Weak-area remedial boost
  if (ctx.targetsWeakArea) score += w.weakAreaRemedial;

  // Progression bonus
  if (ctx.isProgressionStep) score += w.progressionBonus;

  // Collaborative signals
  if (ctx.peerPopularity != null) score += ctx.peerPopularity * w.peerPopularity;
  if (ctx.peerSimilarity != null) score += ctx.peerSimilarity * w.peerSimilarity;

  // Penalties
  if (ctx.hasLowScore) score += w.lowScorePenalty; // negative weight

  return Math.max(0, Math.min(1, score));
}

/**
 * Scores an external resource candidate.
 */
export function scoreExternalResource(
  resource: { tags: string[]; qualityScore: number; saveRate: number; publishedAt?: Date },
  profile: ILearnerProfile
): number {
  const w = RECOMMENDATION_WEIGHTS;
  const overlap = computeTagOverlap(resource.tags, profile.topicAffinities);
  const recency = computeRecencyBonus(resource.publishedAt);
  const proven = resource.saveRate;

  return Math.min(
    1,
    overlap * w.tagOverlap +
      resource.qualityScore * w.qualityScore +
      recency * w.recencyBonus +
      proven * w.provenBonus
  );
}

// ---------------------------------------------------------------------------
// Profile update helpers (called from job handlers)
// ---------------------------------------------------------------------------

/**
 * Adjusts a learner profile's topic affinities based on a content interaction.
 * Returns updated affinities — caller persists them.
 *
 * @param affinities  Existing affinity array
 * @param tags        Tags from the content the user interacted with
 * @param delta       Signed delta (+0.1 for quiz pass, -0.05 for abandon, etc.)
 */
export function updateAffinities(
  affinities: ITopicAffinity[],
  tags: string[],
  delta: number
): ITopicAffinity[] {
  const result = affinities.map((a) => ({ ...a })); // shallow clone

  for (const tag of tags) {
    const existing = result.find(
      (a) => a.tag.toLowerCase() === tag.toLowerCase()
    );
    if (existing) {
      // Decay the existing score before applying the delta
      existing.score = decayAffinityScore(existing.score, existing.lastUpdated);
      existing.score = Math.max(0, Math.min(1, existing.score + delta));
      existing.lastUpdated = new Date();
    } else {
      result.push({
        tag,
        score: Math.max(0, Math.min(1, 0.5 + delta)),
        isFollowed: false,
        lastUpdated: new Date(),
      });
    }
  }

  return result;
}

/**
 * Upserts a weak-area record for a given tag.
 */
export function upsertWeakArea(
  weakAreas: ILearnerProfile["weakAreas"],
  tag: string,
  newScore: number
): ILearnerProfile["weakAreas"] {
  const result = weakAreas.map((w) => ({ ...w }));
  const existing = result.find((w) => w.tag.toLowerCase() === tag.toLowerCase());

  if (existing) {
    // Rolling average
    existing.averageScore =
      (existing.averageScore * existing.attempts + newScore) /
      (existing.attempts + 1);
    existing.attempts += 1;
    existing.lastAssessed = new Date();
    existing.remediationQueued = false; // re-queue remediation check
  } else {
    result.push({
      tag,
      averageScore: newScore,
      attempts: 1,
      remediationQueued: false,
      lastAssessed: new Date(),
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Top-level generation stub
// ---------------------------------------------------------------------------

/**
 * Generates a ranked list of recommendation candidates for a user.
 *
 * This function is called by the `recommendation:generate` background job.
 * It is a pure-scoring layer — it does NOT fetch data or write to MongoDB.
 * The job handler is responsible for:
 *   1. Fetching the learner profile.
 *   2. Fetching candidate content (quizzes, materials, external resources).
 *   3. Building ScoringContext objects.
 *   4. Calling this function.
 *   5. Persisting the top-N results as IRecommendation documents.
 *
 * @param candidates  Array of pre-fetched candidate contexts.
 *                   For external resource candidates, include an `externalResource`
 *                   field with the resource's qualityScore, saveRate, and publishedAt
 *                   so the correct `scoreExternalResource()` path is taken.
 * @param topN        Maximum number of results to return (default 20)
 * @param strategy    Strategy label to attach to each output item
 */
export function generateRecommendations(
  candidates: Array<
    ScoringContext & {
      contentType: RecommendationContentType | "external";
      contentId: Types.ObjectId;
      expiresAt?: Date;
      /** Populated only when contentType === "external". */
      externalResource?: {
        tags: string[];
        qualityScore: number;
        saveRate: number;
        publishedAt?: Date;
      };
    }
  >,
  strategy: RecommendationStrategy,
  topN = 20
): IRecommendedItem[] {
  const scored = candidates
    .filter((c) => {
      // Pre-filter content the user has already dismissed or completed
      const id = c.contentId.toString();
      const profile = c.profile;
      const isDismissed = profile.dismissedContentIds.some(
        (d) => d.toString() === id
      );
      const isCompleted = profile.completedContentIds.some(
        (done) => done.toString() === id
      );
      return !isDismissed && !isCompleted;
    })
    .map((c) => {
      // Use the dedicated external-resource scorer when applicable
      const score =
        c.contentType === "external" && c.externalResource
          ? scoreExternalResource(c.externalResource, c.profile)
          : scoreCandidate(c);
      return {
        contentType: c.contentType,
        contentId: c.contentId,
        score,
        strategy,
        rationale: buildRationale(c, strategy),
        expiresAt: c.expiresAt,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  return scored;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildRationale(
  ctx: ScoringContext & { contentType: RecommendationContentType | "external" },
  strategy: RecommendationStrategy
): string {
  if (ctx.targetsWeakArea) {
    const weakTag = ctx.contentTags.find((tag) =>
      ctx.profile.weakAreas.some(
        (w) => w.tag.toLowerCase() === tag.toLowerCase()
      )
    );
    return weakTag
      ? `Recommended to strengthen your understanding of "${weakTag}".`
      : "Recommended to help you improve in an identified weak area.";
  }

  if (ctx.isProgressionStep) {
    return "Recommended as the next step after your recent progress.";
  }

  const followedMatch = ctx.contentTags.find((tag) =>
    ctx.profile.topicAffinities.some(
      (a) => a.isFollowed && a.tag.toLowerCase() === tag.toLowerCase()
    )
  );
  if (followedMatch) {
    return `Matches your interest in "${followedMatch}".`;
  }

  if (strategy === "trending") {
    return "Trending with students at your university.";
  }

  if (strategy === "collaborative") {
    return "Students with a similar profile found this helpful.";
  }

  if (strategy === "exam_prep") {
    return "Relevant to your upcoming exams.";
  }

  return "Recommended based on your learning history.";
}
