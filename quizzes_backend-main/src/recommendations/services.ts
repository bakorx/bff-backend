import { Types } from "mongoose";
import { z } from "genkit";
import { embedQuery } from "@/learning";
import { redisConnection } from "@/config";
import { Z_MODEL } from "@/ai/config";
import * as eventServices from "@/events/services";
import { UserMemoryFact, MemoryChunk, RecTelemetry, ExternalResource } from "./models";
import { runSystemRuleEngine, gatherCandidateRecs } from "./rule-engine";
import { LLMClient, LLMGenerateResult } from "./llm-client";
import {
  InternalRec,
  ExternalRec,
  IMemoryChunk,
  RecommendationSet,
  ExternalResourceDifficulty,
} from "./interfaces";

// ---------------------------------------------------------------------------
// System tier service (#4) — rec-engine.md §7.3 "Sys" branch.
//
// Pure rules, no LLM. This is ONLY the rule-based generation step — cache,
// recId/tier assembly, and telemetry belong to #6 (Rec endpoint + tier
// resolution), a later Phase 3 item that calls this.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tag-based lookup (#19) — rec-engine.md §13.
//
//   findExternalResources(topicTags, difficulty?, language?, limit=5)
//     filter: status = 'approved' AND (sourceType != 'bulk_import' OR needs_review = false)
//     rank by:
//       1. tag overlap score (count of matching tags)
//       2. difficulty match (exact > 'general' fallback)
//       3. tiebreak: upvotes desc
//       4. tiebreak: viewCount desc
//     return top N
//
// "needs_review = false" -> `verified: true` here, per #13's own doc
// comment on IExternalResource (§5.3 vs §13's filter only reconcile if
// "needs_review" in the filter means the separate `verified` boolean, not
// the status enum's same-named value).
//
// Wired into generateSystemRecs/generatePremiumRecs below (#20 — "Rec
// payload: external recs"). Both derive topicTags from the same real
// source: the user's own UserMemoryFact tags.
// ---------------------------------------------------------------------------

export async function findExternalResources(
  topicTags: string[],
  difficulty?: ExternalResourceDifficulty,
  language?: string,
  limit = 5,
): Promise<ExternalRec[]> {
  const filter: Record<string, unknown> = {
    status: "approved",
    $or: [{ sourceType: { $ne: "bulk_import" } }, { verified: true }],
  };
  if (topicTags.length > 0) {
    filter.topicTags = { $in: topicTags };
  }
  if (language) {
    filter.language = language;
  }

  // Ranking (tag-overlap count, difficulty match) isn't a single Mongo
  // sort key without a $facet/scoring aggregation pipeline — fetch a
  // wider candidate set and rank in memory. Reasonable at this data
  // volume (§13: "p95 latency < 100ms", library seeded in the low
  // hundreds per §15) — would need revisiting if the library grows to
  // where `limit * 10` candidates becomes a real cost.
  const candidates = await ExternalResource.find(filter)
    .limit(limit * 10)
    .lean();

  const scored = candidates.map((r) => {
    const overlap = topicTags.length
      ? r.topicTags.filter((t) => topicTags.includes(t)).length
      : 0;
    const difficultyRank = !difficulty
      ? 0
      : r.difficulty === difficulty
        ? 2
        : r.difficulty === "general"
          ? 1
          : 0;
    return { resource: r, overlap, difficultyRank };
  });

  scored.sort((a, b) => {
    if (b.overlap !== a.overlap) return b.overlap - a.overlap;
    if (b.difficultyRank !== a.difficultyRank) return b.difficultyRank - a.difficultyRank;
    if (b.resource.upvotes !== a.resource.upvotes) return b.resource.upvotes - a.resource.upvotes;
    return b.resource.viewCount - a.resource.viewCount;
  });

  return scored.slice(0, limit).map((s) => ({
    id: String(s.resource._id),
    title: s.resource.title,
    url: s.resource.url,
    source: s.resource.source,
    language: s.resource.language,
    topicTags: s.resource.topicTags,
  }));
}

export async function generateSystemRecs(
  userId: string,
  surface: string,
): Promise<{ internal: InternalRec[]; external: ExternalRec[]; costUsd: number }> {
  const userObjectId = new Types.ObjectId(userId);

  // S1: last 20 events.
  const recentEvents = await eventServices.readEvents({ userId, limit: 20 });

  // S3: top 5 UserMemoryFacts by recency. Not consumed by any of the
  // currently-implemented rules (1, 2, 3, 5 — see rule-engine.ts for which
  // are blocked and why) — but #20 uses their tags to drive S5's lookup.
  const topFacts = await UserMemoryFact.find({ userId: userObjectId })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  // S4: run rule engine (S2, current courses, is read inside the rules
  // that need it — ruleStaleEnrollment, ruleDashboardFallback).
  const internal = await runSystemRuleEngine(userObjectId, surface, recentEvents);

  // S5 (#20): topicTags come from the user's own facts — no "user level"
  // signal exists on the User model to derive a difficulty from (checked;
  // there's no education-level/university field), so difficulty is left
  // unset rather than guessed. An empty tag list (new user, no facts yet)
  // still returns results — findExternalResources ranks by popularity
  // alone when there's nothing to match, covering the doc's "cold start"
  // case for the external slot specifically (rule 6, the *internal*
  // cold-start rec, stays unimplemented — see rule-engine.ts).
  const topicTags = [...new Set(topFacts.flatMap((f) => f.tags))];
  const external = await findExternalResources(topicTags);

  return { internal, external, costUsd: 0 };
}

// ---------------------------------------------------------------------------
// Premium tier service (#5) — rec-engine.md §7.3 "Prem" branch, §9.
//
// "The same rec engine, the same data, the same response endpoint. The
// difference is the LLM call." — candidates come from the exact same rule
// functions system tier uses (rule-engine.ts#gatherCandidateRecs); the LLM
// only selects from and explains that REAL pool, it never invents a
// contentId. This is a deliberate safety constraint, not something the doc
// spells out explicitly — the alternative (letting the LLM free-generate
// recommendations) risks hallucinated ids pointing at content that
// doesn't exist.
// ---------------------------------------------------------------------------

const SYNTHESIS_DAILY_BUDGET: Record<"cooked" | "cruising" | "locked_in", number> = {
  cooked: 10,
  cruising: 20,
  locked_in: 40,
};

const synthesisOutputSchema = z.object({
  selections: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      reason: z.string(),
    }),
  ),
  reasoning: z.string(),
});

/**
 * RAG retrieval (§7.3 P1) — top-N MemoryChunks by vector similarity to a
 * query built from the user's recent activity. Mirrors src/learning/
 * services.ts's $vectorSearch pattern (named-index-first, fall back to
 * "default").
 *
 * NOTE: this will return [] until the Atlas Vector Search index
 * `user_memory_chunks_vector` is provisioned in Atlas — Mongoose can't
 * create Search indexes, only standard ones (see the long-standing comment
 * on MemoryChunk in models.ts, from #1). The query is correct and ready;
 * it just has nothing to search until that index exists.
 */
async function retrieveMemoryChunks(
  userId: Types.ObjectId,
  queryText: string,
  limit: number,
): Promise<IMemoryChunk[]> {
  if (!queryText.trim()) return [];
  const queryEmbedding = await embedQuery(queryText);
  if (queryEmbedding.length === 0) return [];

  const runVectorSearch = async (indexName: string) =>
    MemoryChunk.aggregate([
      {
        $vectorSearch: {
          index: indexName,
          path: "embedding",
          queryVector: queryEmbedding,
          numCandidates: limit * 20,
          limit,
          filter: { userId },
        },
      },
      { $project: { userId: 1, text: 1, tags: 1, score: { $meta: "vectorSearchScore" } } },
    ]);

  try {
    let chunks = await runVectorSearch("user_memory_chunks_vector");
    if (chunks.length === 0) chunks = await runVectorSearch("default");
    return chunks;
  } catch {
    // Index not provisioned yet, or Atlas Search unavailable on this
    // cluster tier — degrade to no RAG context rather than failing the
    // whole rec request (§16 "Failure modes": vector search 0 results ->
    // keyword search on chunks; no separate text index exists for that
    // fallback yet either, so this degrades one step further to "no chunks").
    return [];
  }
}

function eventSummaryLine(e: { eventType: string; payload: unknown }): string {
  return `[${e.eventType}] ${JSON.stringify(e.payload ?? {})}`;
}

export interface PremiumRecsResult {
  internal: InternalRec[];
  external: ExternalRec[];
  reasoning?: string;
  /**
   * Set when synthesis wasn't usable — §16's failure-mode table says both
   * "LLM call errors" and "Daily LLM cap exceeded" should fall back to a
   * full system-tier response (not a premium/no-reasoning hybrid). This
   * function doesn't call generateSystemRecs() itself (that's a layering
   * decision for #6, which owns both services) — it signals the reason so
   * the caller can re-route, and still returns the raw candidate pool as a
   * defensive fallback in case a caller doesn't check this field.
   */
  fallbackReason?: "llm_error" | "budget_exceeded";
  costUsd: number;
}

export async function generatePremiumRecs(
  userId: string,
  surface: string,
  tier: "cooked" | "cruising" | "locked_in",
): Promise<PremiumRecsResult> {
  const userObjectId = new Types.ObjectId(userId);

  // P3: last 50 events.
  const recentEvents = await eventServices.readEvents({ userId, limit: 50 });

  // P2: top 10 UserMemoryFacts by confidence.
  const topFacts = await UserMemoryFact.find({ userId: userObjectId })
    .sort({ confidence: -1 })
    .limit(10)
    .lean();

  // P1: RAG retrieve top-10 MemoryChunks, queried against a summary of
  // recent activity (grounds retrieval in what the user's actually been
  // doing, not a specific candidate).
  const activitySummary = recentEvents.slice(0, 20).map(eventSummaryLine).join("\n");
  const chunks = await retrieveMemoryChunks(userObjectId, activitySummary, 10);

  // Candidate pool — same source as system tier (§9).
  const candidates = await gatherCandidateRecs(userObjectId, recentEvents);

  // P6 (#20): same topicTags-from-facts approach as system tier — see
  // generateSystemRecs's comment for why difficulty is left unset.
  // MemoryChunk.tags would be a second real signal here, but #26's
  // pipeline currently always writes chunks with tags: [] (documented
  // gap there — no tag-derivation logic exists yet), so it contributes
  // nothing today.
  const topicTags = [...new Set(topFacts.flatMap((f) => f.tags))];
  const external = await findExternalResources(topicTags);

  if (candidates.length === 0) {
    return { internal: candidates, external, costUsd: 0 };
  }

  const prompt = buildSynthesisPrompt({ candidates, chunks, topFacts, surface });
  const budget = SYNTHESIS_DAILY_BUDGET[tier];

  let result: LLMGenerateResult<z.infer<typeof synthesisOutputSchema>>;
  try {
    result = await LLMClient.generate<z.infer<typeof synthesisOutputSchema>>({
      userId,
      purpose: "rec_synthesis",
      dailyBudget: budget,
      prompt,
      outputSchema: synthesisOutputSchema,
    });
  } catch {
    // §16: "LLM call errors -> System tier response... Telemetry only."
    return { internal: candidates, external, fallbackReason: "llm_error", costUsd: 0 };
  }

  if (result.budgetExceeded) {
    // §16: "Daily LLM cap exceeded -> Return system tier response... User
    // sees no difference."
    return { internal: candidates, external, fallbackReason: "budget_exceeded", costUsd: 0 };
  }

  if (!result.response) {
    return { internal: candidates, external, fallbackReason: "llm_error", costUsd: result.costUsd };
  }

  // Safety: only accept selections whose (type, id) matches a REAL
  // candidate — never trust an LLM-returned id directly.
  const byKey = new Map(candidates.map((c) => [`${c.type}:${c.id}`, c]));
  const selected: InternalRec[] = [];
  for (const s of result.response.selections) {
    const match = byKey.get(`${s.type}:${s.id}`);
    if (match) selected.push({ ...match, reason: s.reason });
  }

  if (selected.length === 0) {
    // LLM returned zero valid selections (all hallucinated, or genuinely
    // found nothing worth surfacing) — raw candidate pool, no reasoning,
    // but NOT a §16 failure mode (the call succeeded), so no fallbackReason.
    return { internal: candidates, external, costUsd: result.costUsd };
  }

  return {
    internal: selected,
    external,
    reasoning: result.response.reasoning,
    costUsd: result.costUsd,
  };
}

function buildSynthesisPrompt(ctx: {
  candidates: InternalRec[];
  chunks: IMemoryChunk[];
  topFacts: { fact: string; confidence: number }[];
  surface: string;
}): string {
  const candidateList = ctx.candidates
    .map((c) => `- id=${c.id} type=${c.type} title="${c.title}"`)
    .join("\n");
  const chunkText = ctx.chunks.map((c) => `- ${c.text}`).join("\n") || "(none)";
  const factText = ctx.topFacts.map((f) => `- ${f.fact} (confidence ${f.confidence})`).join("\n") || "(none)";

  return `You are Z, an academic recommendation assistant on the Qz platform. Select which of these candidate recommendations to surface to the student on the "${ctx.surface}" surface, and explain why, grounded ONLY in the context below. Do not invent a candidate not listed — only select from the list by exact id and type.

Candidates:
${candidateList}

What we know about this student (memory):
${chunkText}

Known facts about this student:
${factText}

For each candidate worth surfacing, return its id, type, and a 1-sentence reason referencing the student's actual history above. Also write a brief overall "reasoning" summary. Select at most 5 candidates, fewer if fewer are genuinely relevant.`;
}

// ---------------------------------------------------------------------------
// Rec endpoint orchestration (#6) — rec-engine.md §7.3 (lookup order), §7.4
// (cache), §3 (tier resolution). This is the "Rec API" component: tier
// resolution, cache, response shape, telemetry. The controller (#6's HTTP
// layer) just calls getRecommendationSet(userId, surface).
//
// NOT implemented here: §7.4's explicit cache-bust triggers (quiz fail,
// session finish, manual admin override) — that needs wiring into the
// existing #25 event hooks (app/controllers.ts, schedulers/handlers/ai.ts)
// to call redisConnection.del() on those specific events, which is
// additional integration work beyond "the rec endpoint itself". The TTL
// (§3's per-tier table) is the only expiry mechanism right now — a stale
// cache can serve for up to the full TTL after a triggering event.
// ---------------------------------------------------------------------------

/** §3 "Effective states" table — per-tier cache TTL, in seconds. */
const CACHE_TTL_SECONDS: Record<"free" | "cooked" | "cruising" | "locked_in", number> = {
  free: 6 * 60 * 60,
  cooked: 4 * 60 * 60,
  cruising: 2 * 60 * 60,
  locked_in: 60 * 60,
};

function engineTier(planTier: "free" | "cooked" | "cruising" | "locked_in"): "system" | "premium" {
  return planTier === "free" ? "system" : "premium";
}

function cacheKey(userId: string, surface: string, planTier: string): string {
  return `rec:${userId}:${surface}:${planTier}`;
}

async function getCached(key: string): Promise<RecommendationSet | null> {
  try {
    const raw = await redisConnection.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RecommendationSet;
    // Dates survive JSON.stringify as strings — rehydrate for callers.
    parsed.generatedAt = new Date(parsed.generatedAt);
    parsed.cachedUntil = new Date(parsed.cachedUntil);
    return parsed;
  } catch {
    // §16 "Cache down -> Bypass, hit DB, log."
    return null;
  }
}

async function setCached(key: string, value: RecommendationSet, ttlSeconds: number): Promise<void> {
  try {
    await redisConnection.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // §16 "Cache down -> Bypass... log." — a failed cache write doesn't
    // fail the request; the next request just recomputes.
  }
}

export async function getRecommendationSet(
  userId: string,
  surface: string,
): Promise<RecommendationSet> {
  const start = Date.now();
  const planTier = await eventServices.resolveUserTier(userId);
  const tier = engineTier(planTier);
  const key = cacheKey(userId, surface, planTier);

  const cached = await getCached(key);
  if (cached) {
    await RecTelemetry.create({
      recId: cached.recId,
      userId,
      tier,
      surface,
      costUsd: 0,
      latencyMs: Date.now() - start,
      cached: true,
      errored: false,
    });
    return cached;
  }

  const recId = `rec:${userId}:${surface}:${Date.now()}`;
  let internal: InternalRec[];
  let external: ExternalRec[];
  let reasoning: string | undefined;
  let costUsd = 0;
  let modelUsed: string | undefined;
  let errored = false;
  let fallbackReason: "llm_error" | "vector_search_0_results" | "budget_exceeded" | undefined;

  if (tier === "system") {
    const result = await generateSystemRecs(userId, surface);
    internal = result.internal;
    external = result.external;
  } else {
    const premiumTier = planTier as "cooked" | "cruising" | "locked_in";
    const result = await generatePremiumRecs(userId, surface, premiumTier);

    if (result.fallbackReason) {
      // §16: LLM error or daily cap exceeded -> full system-tier response,
      // not premium's own no-reasoning candidate fallback.
      errored = result.fallbackReason === "llm_error";
      fallbackReason = result.fallbackReason;
      const sysResult = await generateSystemRecs(userId, surface);
      internal = sysResult.internal;
      external = sysResult.external;
    } else {
      internal = result.internal;
      external = result.external;
      reasoning = result.reasoning;
      costUsd = result.costUsd;
      if (reasoning) modelUsed = String(Z_MODEL);
    }
  }

  const generatedAt = new Date();
  const ttlSeconds = CACHE_TTL_SECONDS[planTier];
  const cachedUntil = new Date(generatedAt.getTime() + ttlSeconds * 1000);

  const recSet: RecommendationSet = {
    recId,
    surface,
    tier,
    internal,
    external,
    ...(reasoning && { reasoning }),
    generatedAt,
    cachedUntil,
  };

  await setCached(key, recSet, ttlSeconds);

  await RecTelemetry.create({
    recId,
    userId,
    tier,
    surface,
    costUsd,
    latencyMs: Date.now() - start,
    cached: false,
    ...(modelUsed && { modelUsed }),
    errored,
    ...(fallbackReason && { fallbackReason }),
  });

  return recSet;
}
