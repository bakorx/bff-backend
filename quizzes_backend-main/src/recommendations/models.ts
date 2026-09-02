import { Schema, model, Model, Types } from "mongoose";
import {
  IUserMemoryFact,
  IMemoryChunk,
  ILLMUsage,
  IMemoryPipelineRun,
  IExternalResource,
  IRecTelemetry,
  IDelayedRecFlag,
} from "./interfaces";

const SourceRefSchema = new Schema(
  {
    type: { type: String, required: true },
    id: { type: Schema.Types.ObjectId, required: true },
  },
  { _id: false },
);

// ---------------------------------------------------------------------------
// UserMemoryFact — per-user, persistent knowledge extracted from sessions,
// quizzes, and notes. See docs/rec-engine.md §5.1 and §6 (write pipeline,
// not yet implemented — this is the schema only).
// ---------------------------------------------------------------------------

const UserMemoryFactSchema = new Schema<IUserMemoryFact>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    fact: { type: String, required: true, trim: true },
    source: {
      type: String,
      enum: ["session", "quiz", "note", "inferred"],
      required: true,
    },
    sourceRef: { type: SourceRefSchema, required: true },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    tags: { type: [String], default: [] },
    expiresAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

UserMemoryFactSchema.index({ userId: 1 });
// Read path (rec-engine.md §7.5) pulls "top N facts by recency/confidence"
// scoped to a user, and later a topic — this index covers the common case.
UserMemoryFactSchema.index({ userId: 1, tags: 1 });
// Dedup (§7 invariants): userId + sourceRef + fact. Re-running the pipeline
// for the same (user, day) — see memory-pipeline.ts's deterministic
// sourceRef.id derivation — must not duplicate a fact it already wrote.
UserMemoryFactSchema.index(
  { userId: 1, "sourceRef.type": 1, "sourceRef.id": 1, fact: 1 },
  { unique: true },
);

export const UserMemoryFact: Model<IUserMemoryFact> = model<IUserMemoryFact>(
  "UserMemoryFact",
  UserMemoryFactSchema,
);

// ---------------------------------------------------------------------------
// MemoryChunk — RAG-ready embeddings of past content. See docs/rec-engine.md
// §5.2. Schema only — the write pipeline (§6) that actually populates this
// collection is separate follow-up work.
//
// IMPORTANT: the Atlas Vector Search index this model depends on for reads
// (`user_memory_chunks_vector`, on `embedding`) is NOT created by this
// schema. Mongoose's schema-level .index() only provisions standard MongoDB
// indexes — Atlas Search/Vector Search indexes must be created separately
// (Atlas UI, Atlas CLI, or the driver's createSearchIndex), the same way
// `session_material_chunks_vector` is provisioned for src/learning's
// MaterialChunk (see src/learning/services.ts's $vectorSearch usage for the
// query-side pattern to mirror once the read path is built). Do this before
// Phase 2/3 read-path work lands, or $vectorSearch against this collection
// will silently return zero results.
//
// The doc's index list groups `{ userId: 1, expiresAt: 1 }` under "TTL
// cleanup", but MongoDB TTL indexes must be single-field — a compound TTL
// index isn't honoured the way a single-field one is. Implemented here as
// two indexes instead: the compound one for querying, and a genuine
// single-field TTL index on `expiresAt`.
// ---------------------------------------------------------------------------

const MemoryChunkSchema = new Schema<IMemoryChunk>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    source: {
      type: String,
      enum: ["session", "quiz", "note", "transcript"],
      required: true,
    },
    sourceRef: { type: SourceRefSchema, required: true },
    chunkIndex: { type: Number, required: true },
    text: { type: String, required: true },
    embedding: { type: [Number], default: [] },
    tags: { type: [String], default: [] },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Recency queries — rec-engine.md §5.2's index list.
MemoryChunkSchema.index({ userId: 1, createdAt: -1 });
// Query-support compound index for "this user's chunks nearing expiry".
MemoryChunkSchema.index({ userId: 1, expiresAt: 1 });
// The actual TTL auto-delete index — must be single-field (see note above).
MemoryChunkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Dedup (§7 invariants): userId + sourceRef + chunkIndex.
MemoryChunkSchema.index(
  { userId: 1, "sourceRef.type": 1, "sourceRef.id": 1, chunkIndex: 1 },
  { unique: true },
);

export const MemoryChunk: Model<IMemoryChunk> = model<IMemoryChunk>(
  "MemoryChunk",
  MemoryChunkSchema,
);

// ---------------------------------------------------------------------------
// ExternalResource (#13) — rec-engine.md §5.3, §12, §13. Model only — see
// interfaces.ts's IExternalResource doc comment for the `verified` field's
// reconciliation of a real ambiguity between §5.3 and §13.
// ---------------------------------------------------------------------------

/** Fixed sentinel id for `moderatedBy` on auto-approved bulk imports (§12: "moderatedBy: SYSTEM"). Not a real User document. */
export const SYSTEM_MODERATOR_ID = new Types.ObjectId("000000000000000000000000");

const ExternalResourceSchema = new Schema<IExternalResource>(
  {
    title: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    source: {
      type: String,
      enum: ["youtube", "pdf", "article", "file"],
      required: true,
    },
    topicTags: { type: [String], default: [] },
    difficulty: {
      type: String,
      enum: ["bece", "wassce", "undergrad", "general"],
      required: true,
    },
    language: { type: String, required: true, default: "en" },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "needs_review"],
      required: true,
      default: "pending",
    },
    submittedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    moderatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    moderatedAt: { type: Date },
    rejectionReason: { type: String },
    viewCount: { type: Number, required: true, default: 0 },
    upvotes: { type: Number, required: true, default: 0 },
    sourceType: {
      type: String,
      enum: ["community", "public_library", "bulk_import"],
      required: true,
    },
    submitterOptIn: { type: Boolean, required: true, default: true },
    verified: { type: Boolean, required: true, default: false },
    spotCheckedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Lookup (§13's findExternalResources, #19 — not built yet, this is the
// index it'll need).
ExternalResourceSchema.index({ status: 1, topicTags: 1 });
// A user's own submissions.
ExternalResourceSchema.index({ submittedBy: 1 });
// Filter by origin (auditing/moderation queue).
ExternalResourceSchema.index({ sourceType: 1 });
// Ranking tiebreaks (§13: "tiebreak: viewCount desc").
ExternalResourceSchema.index({ viewCount: -1 });
// Liveness cron (#22, §13) keyset pagination: find({status:'approved',
// _id:{$gt:lastId}}).sort({_id:1}) — stable under mutation mid-run, since
// the cron itself flips some of these resources' status as it goes.
ExternalResourceSchema.index({ status: 1, _id: 1 });

export const ExternalResource: Model<IExternalResource> =
  model<IExternalResource>("ExternalResource", ExternalResourceSchema);

// ---------------------------------------------------------------------------
// LLMUsage — per-user-per-day LLM call counter backing the LLM client
// wrapper's budget enforcement (§15). See interfaces.ts for why this exists
// (the doc specifies the cap behavior, not a tracking model) and for why
// `purpose` is a real field, not decoration — §7 and §15 define two
// separate, differently-sized daily budgets that both consume LLM calls.
// ---------------------------------------------------------------------------

const LLMUsageSchema = new Schema<ILLMUsage>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  date: { type: String, required: true },
  purpose: {
    type: String,
    enum: ["memory_extraction", "rec_synthesis"],
    required: true,
  },
  callCount: { type: Number, required: true, default: 0 },
  // Rolling counter with no long-term value once its day has passed.
  createdAt: {
    type: Date,
    default: () => new Date(),
    expires: 60 * 24 * 60 * 60,
  },
});

LLMUsageSchema.index({ userId: 1, date: 1, purpose: 1 }, { unique: true });

export const LLMUsage: Model<ILLMUsage> = model<ILLMUsage>(
  "LLMUsage",
  LLMUsageSchema,
);

// ---------------------------------------------------------------------------
// MemoryPipelineRun — telemetry for #26's nightly extraction cron.
// rec-engine.md §14 "EventBus telemetry" / §7 flowchart step M
// ("Telemetry: memory_pipeline:run").
// ---------------------------------------------------------------------------

const MemoryPipelineRunSchema = new Schema<IMemoryPipelineRun>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    runId: { type: String, required: true },
    windowStart: { type: Date, required: true },
    windowEnd: { type: Date, required: true },
    eventTypes: { type: [String], default: [] },
    tier: {
      type: String,
      enum: ["free", "cooked", "cruising", "locked_in"],
      required: true,
    },
    extractionCostUsd: { type: Number, required: true, default: 0 },
    extractedFacts: { type: Number, required: true, default: 0 },
    extractedChunks: { type: Number, required: true, default: 0 },
    extractionBudgetExceeded: { type: Boolean, required: true, default: false },
    dropped: { type: Number, required: true, default: 0 },
    droppedReason: {
      type: String,
      enum: ["backpressure", "pre_filter", "dedup_collision", "schema_invalid"],
    },
    occurredAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

MemoryPipelineRunSchema.index({ userId: 1, occurredAt: -1 });
// 90-day retention per §14.
MemoryPipelineRunSchema.index(
  { occurredAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);

export const MemoryPipelineRun: Model<IMemoryPipelineRun> =
  model<IMemoryPipelineRun>("MemoryPipelineRun", MemoryPipelineRunSchema);

// ---------------------------------------------------------------------------
// RecTelemetry (#6) — rec-engine.md §5.4, §14. Deferred from #26, which
// only needed memory-pipeline telemetry (MemoryPipelineRun above); this is
// for the separate rec-REQUEST path.
// ---------------------------------------------------------------------------

const RecTelemetrySchema = new Schema<IRecTelemetry>(
  {
    recId: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    tier: { type: String, enum: ["system", "premium"], required: true },
    surface: { type: String, required: true },
    costUsd: { type: Number, required: true, default: 0 },
    latencyMs: { type: Number, required: true },
    cached: { type: Boolean, required: true, default: false },
    modelUsed: { type: String },
    errored: { type: Boolean, required: true, default: false },
    fallbackReason: {
      type: String,
      enum: ["llm_error", "vector_search_0_results", "budget_exceeded"],
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

RecTelemetrySchema.index({ userId: 1, createdAt: -1 });
RecTelemetrySchema.index({ recId: 1 });
// 90-day retention, same as MemoryPipelineRun (§14).
RecTelemetrySchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);

export const RecTelemetry: Model<IRecTelemetry> = model<IRecTelemetry>(
  "RecTelemetry",
  RecTelemetrySchema,
);

// ---------------------------------------------------------------------------
// DelayedRecFlag (#11) — rec-engine.md §11 worker-side idempotency record.
// ---------------------------------------------------------------------------

const DelayedRecFlagSchema = new Schema<IDelayedRecFlag>({
  originalEventId: { type: Schema.Types.ObjectId, required: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  surface: { type: String, required: true },
  processedAt: { type: Date, required: true, default: () => new Date() },
});

DelayedRecFlagSchema.index({ originalEventId: 1 }, { unique: true });
// Rolling record with no long-term value once the 7-day stale-job window
// (§11) has long passed.
DelayedRecFlagSchema.index(
  { processedAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 },
);

export const DelayedRecFlag: Model<IDelayedRecFlag> = model<IDelayedRecFlag>(
  "DelayedRecFlag",
  DelayedRecFlagSchema,
);
