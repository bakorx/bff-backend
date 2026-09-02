import { Document, Types } from "mongoose";
import { RecommendationContentType } from "@/learning";

// ---------------------------------------------------------------------------
// Recommendation strategy types
// ---------------------------------------------------------------------------

/**
 * The algorithm used to generate a batch of recommendations.
 *
 * content_based   — match content tags to the learner's topic affinities.
 * collaborative   — find peers with similar profiles and surface what they engaged with.
 * hybrid          — weighted blend of content_based + collaborative (default).
 * remedial        — target the user's documented weak areas.
 * exam_prep       — surface content related to upcoming exams in the timetable.
 * trending        — surface currently popular content in the same university.
 * external        — surface curated external resources.
 */
export type RecommendationStrategy =
  | "content_based"
  | "collaborative"
  | "hybrid"
  | "remedial"
  | "exam_prep"
  | "trending"
  | "external";

// ---------------------------------------------------------------------------
// ITopicAffinity — one slot in a learner's topic preference map
// ---------------------------------------------------------------------------

export interface ITopicAffinity {
  /** Topic tag string — e.g. "sorting algorithms", "thermodynamics". */
  tag: string;
  /**
   * Computed affinity score in [0, 1].
   * Raised when the user engages with content carrying this tag;
   * decayed over time (half-life ≈ 30 days) so stale interests fade.
   */
  score: number;
  /** True if the user explicitly followed / bookmarked this topic. */
  isFollowed: boolean;
  /** Last time the score was updated. */
  lastUpdated: Date;
}

// ---------------------------------------------------------------------------
// IWeakArea — a topic where the learner consistently underperforms
// ---------------------------------------------------------------------------

export interface IWeakArea {
  /** Topic tag string matching the quiz question's lectureNumber or tag. */
  tag: string;
  /** Rolling average score (0–100) for quizzes touching this topic. */
  averageScore: number;
  /** Total quiz attempts that contributed to this weak-area record. */
  attempts: number;
  /** True if the engine has already surfaced remedial content for this area. */
  remediationQueued: boolean;
  lastAssessed: Date;
}

// ---------------------------------------------------------------------------
// ILearnerProfile — the computation-input shape engine.ts's pure scoring
// functions operate on.
//
// This is deliberately NOT a Mongoose Document anymore. The v0 dedicated
// LearnerProfile collection was removed (see issue #220) — it was never
// wired to anything. Phase 2 of the rec-engine.md rebuild will decide how
// to actually source this shape (most likely derived from UserMemoryFact
// rather than a standalone collection); this interface just preserves the
// contract engine.ts's scoring math already depends on, so that reusable
// logic keeps compiling and stays ready to be wired up again.
// ---------------------------------------------------------------------------

export interface ILearnerProfile {
  topicAffinities: ITopicAffinity[];
  weakAreas: IWeakArea[];
  /** Content the user has explicitly dismissed ("Not interested"). */
  dismissedContentIds: Types.ObjectId[];
  /** Content the user has already completed / fully viewed. */
  completedContentIds: Types.ObjectId[];
  /** Content the user started but never finished (< 50% progress). */
  abandonedContentIds: Types.ObjectId[];
  /** Snapshot of the user's average quiz score across all attempts. */
  overallAverageScore: number;
}

// ---------------------------------------------------------------------------
// IRecommendedItem — an ephemeral scored item produced by the engine
// ---------------------------------------------------------------------------

export interface IRecommendedItem {
  contentType: RecommendationContentType | "external";
  contentId: Types.ObjectId;
  /** Final blended score in [0, 1]. */
  score: number;
  strategy: RecommendationStrategy;
  /** Human-readable explanation surfaced to the user. */
  rationale: string;
  /** Derived expiry — e.g. exam date for exam_prep items. */
  expiresAt?: Date;
}

// ---------------------------------------------------------------------------
// Memory models — see docs/rec-engine.md §5 and §6.
// ---------------------------------------------------------------------------

/** Pointer back to the source document a fact or chunk was extracted from. */
export interface ISourceRef {
  type: string;
  id: Types.ObjectId;
}

/**
 * UserMemoryFact — per-user, persistent knowledge extracted from sessions,
 * quizzes, and notes. rec-engine.md §5.1.
 */
export interface IUserMemoryFact extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** e.g. "struggles with derivatives" */
  fact: string;
  source: "session" | "quiz" | "note" | "inferred";
  sourceRef: ISourceRef;
  /** Confidence from the extraction model, 0..1. */
  confidence: number;
  tags: string[];
  createdAt: Date;
  /** Optional TTL — facts can decay. */
  expiresAt?: Date;
}

/**
 * MemoryChunk — RAG-ready embeddings of past content, indexed for Atlas
 * Vector Search. rec-engine.md §5.2.
 */
export interface IMemoryChunk extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  source: "session" | "quiz" | "note" | "transcript";
  sourceRef: ISourceRef;
  /**
   * Position within the batch this chunk was produced from. Part of the
   * §6/§7 dedup key (userId + sourceRef + chunkIndex) — added for #26,
   * since a single pipeline run produces multiple chunks sharing one
   * sourceRef (the run itself, not a single source document).
   */
  chunkIndex: number;
  /** The embedded chunk, ~500 tokens. */
  text: string;
  /** openai/text-embedding-3-small, 1536 dims. */
  embedding: number[];
  tags: string[];
  createdAt: Date;
  /** 90 days default; enforced via a Mongo TTL index. */
  expiresAt: Date;
}

// ---------------------------------------------------------------------------
// ExternalResource (#13) — rec-engine.md §5.3, §12, §13.
// ---------------------------------------------------------------------------

export type ExternalResourceSource = "youtube" | "pdf" | "article" | "file";
export type ExternalResourceDifficulty =
  | "bece"
  | "wassce"
  | "undergrad"
  | "general";
export type ExternalResourceStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "needs_review";
export type ExternalResourceSourceType =
  | "community"
  | "public_library"
  | "bulk_import";

/**
 * Unified table for community submissions, public library materials, and
 * bulk imports (§12). Model only — submission/moderation/lookup APIs are
 * separate build-order items (#14, #16, #17, #18, #19, #22), not part of
 * #13.
 *
 * `verified` reconciles a genuine ambiguity between §5.3 and §13: §5.3's
 * `status` enum has a `needs_review` value (an approved resource whose URL
 * later broke a liveness check — see §13's "Quality control" table). But
 * §13's own lookup filter is `status = 'approved' AND (sourceType !=
 * 'bulk_import' OR needs_review = false)` — treating "needs_review" as a
 * boolean gate checked *alongside* status='approved', which only makes
 * sense if it's a distinct concept from the status value of the same name.
 * Read together with §12 ("bulk_import -> auto-approved on insert... The
 * needs_review flag is set to true until the first liveness cron pass
 * returns 2xx"), the coherent reading is: bulk imports get status=
 * 'approved' immediately, but stay excluded from lookups via this
 * *separate* boolean until their first real liveness check passes. Named
 * `verified` here to avoid the status-value name collision.
 */
export interface IExternalResource extends Document {
  _id: Types.ObjectId;
  title: string;
  url: string;
  source: ExternalResourceSource;
  topicTags: string[];
  difficulty: ExternalResourceDifficulty;
  language: string;
  status: ExternalResourceStatus;
  /** null for bulk_import (§12: "submittedBy: null, sourceType: 'bulk_import'"). */
  submittedBy: Types.ObjectId | null;
  /** Unset until moderated. SYSTEM_MODERATOR_ID (models.ts) for auto-approved bulk imports. */
  moderatedBy?: Types.ObjectId;
  moderatedAt?: Date;
  rejectionReason?: string;
  viewCount: number;
  upvotes: number;
  sourceType: ExternalResourceSourceType;
  /** Whether the submitter's name shows on the approved card. Defaults true. */
  submitterOptIn: boolean;
  /** See the doc comment above — distinct from status='needs_review'. */
  verified: boolean;
  /** Set by the weekly spot-check cron (#22, §13 "Spot-check sampling") when this resource is randomly selected for admin re-review. Not cleared automatically — a later spot-check run can re-select the same resource. */
  spotCheckedAt?: Date;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Read path response shapes (#4/#5/#6) — rec-engine.md §8.
// ---------------------------------------------------------------------------

export type InternalRecType =
  | "quiz"
  | "session"
  | "course"
  | "note"
  | "flashcard_set"
  | "lesson"
  | "walkthrough";

export type InternalRecStatus = "pending_generation" | "ready" | "shown";

export interface InternalRec {
  id: string;
  type: InternalRecType;
  title: string;
  score: number;
  /** Premium only. */
  reason?: string;
  status: InternalRecStatus;
  /** Session id + skill name — only set for generate-vs-retrieve types (§8.6). Unused by #4 (system tier only produces "retrieve" types). */
  generationRef?: string;
}

export interface ExternalRec {
  id: string;
  title: string;
  url: string;
  source: "youtube" | "pdf" | "article" | "file";
  language: string;
  topicTags: string[];
}

export interface RecommendationSet {
  recId: string;
  surface: string;
  tier: "system" | "premium";
  internal: InternalRec[];
  external: ExternalRec[];
  /** Premium only. */
  reasoning?: string;
  generatedAt: Date;
  cachedUntil: Date;
}

// ---------------------------------------------------------------------------
// Memory write pipeline (#26) — rec-engine.md §7, §14, §15.
// ---------------------------------------------------------------------------

/**
 * Per-user-per-day LLM call counter, backing the LLM client wrapper's
 * budget enforcement (§15 "Per-user daily caps"). Not a doc-described
 * model by name — the doc specifies the *behavior* (hard per-user daily
 * cap) without specifying how it's tracked; this is the tracking table.
 *
 * `purpose` exists because §7 and §15 define TWO separate, differently-
 * sized daily budgets that both consume LLM calls: memory-pipeline
 * extraction (§7 — cooked:1, cruising:2, locked_in:4) and rec-request
 * synthesis (§15 "LLM-backed rec requests" — cooked:10, cruising:20,
 * locked_in:40). A single undifferentiated counter would conflate them —
 * a user's rec requests would eat into their memory-extraction budget and
 * vice versa. Scoped by (userId, date, purpose) instead.
 */
export interface ILLMUsage extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** UTC date, YYYY-MM-DD. */
  date: string;
  purpose: "memory_extraction" | "rec_synthesis";
  callCount: number;
  /** TTL anchor — rolling counter with no long-term value past its day. */
  createdAt: Date;
}

/**
 * One row per (user, batch) memory-pipeline run. rec-engine.md §14
 * "EventBus telemetry" — the memory_pipeline:run telemetry referenced in
 * §7's flowchart step M.
 */
export interface IMemoryPipelineRun extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  runId: string;
  windowStart: Date;
  windowEnd: Date;
  eventTypes: string[];
  tier: "free" | "cooked" | "cruising" | "locked_in";
  extractionCostUsd: number;
  extractedFacts: number;
  extractedChunks: number;
  extractionBudgetExceeded: boolean;
  dropped: number;
  droppedReason?:
    | "backpressure"
    | "pre_filter"
    | "dedup_collision"
    | "schema_invalid";
  occurredAt: Date;
}

/**
 * One row per recommendation request (#6). rec-engine.md §5.4, §14.
 * Deferred from #26 — that item only needed memory-pipeline telemetry
 * (IMemoryPipelineRun above); this is for the separate rec-REQUEST path.
 */
export interface IRecTelemetry extends Document {
  _id: Types.ObjectId;
  /** Appendix B format: rec:{userId}:{surface}:{timestamp}. */
  recId: string;
  userId: Types.ObjectId;
  tier: "system" | "premium";
  surface: string;
  costUsd: number;
  latencyMs: number;
  cached: boolean;
  modelUsed?: string;
  errored: boolean;
  fallbackReason?: "llm_error" | "vector_search_0_results" | "budget_exceeded";
  createdAt: Date;
}

/**
 * Idempotency record for the 24h-after-flag cron (#11). rec-engine.md §11:
 * "Same originalEventId cannot fire twice (idempotency check on the
 * worker)." A unique index on originalEventId backs this — the worker
 * tries to insert one before generating/pushing the delayed rec; a
 * duplicate-key error means it was already processed (or is being
 * processed by a concurrent retry), so it skips.
 */
export interface IDelayedRecFlag extends Document {
  _id: Types.ObjectId;
  originalEventId: Types.ObjectId;
  userId: Types.ObjectId;
  surface: string;
  processedAt: Date;
}
