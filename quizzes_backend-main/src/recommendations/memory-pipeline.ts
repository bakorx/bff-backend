import { Types } from "mongoose";
import crypto from "crypto";
import { z } from "genkit";
import { logger } from "@/config";
import { Event, IEvent, EventTier, EXTRACTION_ELIGIBLE_EVENTS } from "@/events";
import * as eventServices from "@/events/services";
import { chunkDocument, embedChunks } from "@/learning";
import { UserMemoryFact, MemoryChunk, MemoryPipelineRun } from "./models";
import { generateRuleBasedFacts } from "./memory-rules";
import { LLMClient } from "./llm-client";

// ---------------------------------------------------------------------------
// Memory write pipeline (#26) — rec-engine.md §7.
//
// "A nightly, batched job that drains the event bus (§6) into UserMemory.
// The pipeline does NOT read hooks from controllers directly — it reads
// from EventStore." This is that job. Cron registration lives in
// src/schedulers/index.ts (02:00 UTC daily, matching §7's trigger).
// ---------------------------------------------------------------------------

const EXTRACTION_DAILY_BUDGET: Record<EventTier, number> = {
  free: 0,
  cooked: 1,
  cruising: 2,
  locked_in: 4,
};

const CHUNK_SIZE_TOKENS: Record<EventTier, number> = {
  free: 1000,
  cooked: 750,
  cruising: 500,
  locked_in: 300,
};

const FACTS_PER_RUN: Record<EventTier, number> = {
  free: 2,
  cooked: 3,
  cruising: 5,
  locked_in: 8,
};

type MemoryPipelineDroppedReason =
  | "backpressure"
  | "pre_filter"
  | "dedup_collision"
  | "schema_invalid";

const extractionOutputSchema = z.object({
  facts: z.array(
    z.object({
      fact: z.string(),
      confidence: z.number().min(0).max(1),
      tags: z.array(z.string()).default([]),
    }),
  ),
});

/**
 * A single pipeline run for one user produces multiple UserMemoryFact/
 * MemoryChunk records, all sharing one sourceRef — the run itself, keyed
 * deterministically by (userId, date) so re-running the same day's batch
 * is idempotent (§7 invariant) instead of duplicating records. This isn't
 * a real Mongo document id — it's a stable hash used only as a dedup key.
 */
function deterministicRunSourceRefId(userId: string, date: string): Types.ObjectId {
  const hash = crypto.createHash("sha256").update(`${userId}:${date}`).digest();
  return new Types.ObjectId(hash.subarray(0, 12));
}

function eventSummaryLine(e: IEvent): string {
  const payloadStr = Object.entries((e.payload as Record<string, unknown>) || {})
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(", ");
  return `[${e.eventType}] ${payloadStr}`;
}

function buildExtractionPrompt(summaryText: string, maxFacts: number): string {
  return `You are extracting durable study facts about a student from a log of their recent activity.

Activity log:
${summaryText}

Extract up to ${maxFacts} short, specific facts about this student's study patterns, strengths, or weak areas. Each fact should be a single sentence, grounded only in what's in the log above — do not invent topics or details not present in the log. Tag each fact with 1-3 short lowercase tags (e.g. "weak_area", "strength", "consistency").`;
}

async function persistFact(
  userId: string,
  fact: string,
  sourceRef: { type: string; id: Types.ObjectId },
  confidence: number,
  tags: string[],
): Promise<boolean> {
  try {
    await UserMemoryFact.create({ userId, fact, source: "inferred", sourceRef, confidence, tags });
    return true;
  } catch (err: any) {
    if (err?.code === 11000) return false; // dedup collision — idempotent rerun, not an error
    throw err;
  }
}

export async function runMemoryPipelineForUser(
  userId: string,
  windowStart: Date,
  windowEnd: Date,
): Promise<void> {
  const date = windowStart.toISOString().slice(0, 10);
  const runId = `${userId}:${date}`;
  const sourceRef = { type: "memory_pipeline_run", id: deterministicRunSourceRefId(userId, date) };

  let extractedFacts = 0;
  let extractedChunks = 0;
  let extractionCostUsd = 0;
  let extractionBudgetExceeded = false;
  let dropped = 0;
  let droppedReason: MemoryPipelineDroppedReason | undefined;
  let tier: EventTier = "free";
  let eventTypes: string[] = [];

  try {
    const allEvents = await eventServices.readEvents({ userId, since: windowStart });
    eventTypes = [...new Set(allEvents.map((e) => e.eventType))];

    const privateEvents = allEvents.filter((e) => e.privacy === "private");
    const publicEvents = allEvents.filter((e) => e.privacy === "public");
    if (privateEvents.length > 0) {
      // Privacy (§7 invariants): private events are filtered out before
      // extraction, not deleted — they stay in EventStore. Free users get
      // zero derived value from them; that's already true here since they
      // never reach the fact/chunk generation below.
      dropped += privateEvents.length;
      droppedReason = "pre_filter";
    }

    tier = await eventServices.resolveUserTier(userId);

    if (publicEvents.length > 0) {
      if (tier === "free") {
        const facts = generateRuleBasedFacts(publicEvents, FACTS_PER_RUN.free);
        for (const f of facts) {
          if (await persistFact(userId, f.fact, sourceRef, f.confidence, f.tags)) extractedFacts++;
        }
      } else {
        const eligibleTypes = EXTRACTION_ELIGIBLE_EVENTS[tier];
        const summaryEvents = publicEvents.filter((e) => eligibleTypes.includes(e.eventType));

        if (summaryEvents.length > 0) {
          const summaryText = summaryEvents.map(eventSummaryLine).join("\n");

          const rawChunks = chunkDocument(summaryText, CHUNK_SIZE_TOKENS[tier]);
          const embedded = await embedChunks(rawChunks);
          for (let i = 0; i < embedded.length; i++) {
            try {
              await MemoryChunk.create({
                userId,
                // "transcript" is the closest fit in the existing enum for
                // a chunk built from an aggregated multi-event batch rather
                // than one single session/quiz/note — see #26's commit notes.
                source: "transcript",
                sourceRef,
                chunkIndex: i,
                text: embedded[i].text,
                embedding: embedded[i].embedding,
                tags: [],
              });
              extractedChunks++;
            } catch (err: any) {
              if (err?.code !== 11000) throw err;
            }
          }

          const budget = EXTRACTION_DAILY_BUDGET[tier];
          const llmResult = await LLMClient.generate<z.infer<typeof extractionOutputSchema>>({
            userId,
            purpose: "memory_extraction",
            dailyBudget: budget,
            prompt: buildExtractionPrompt(summaryText, FACTS_PER_RUN[tier]),
            outputSchema: extractionOutputSchema,
          });

          if (llmResult.budgetExceeded) {
            extractionBudgetExceeded = true;
            const fallbackFacts = generateRuleBasedFacts(publicEvents, FACTS_PER_RUN.free);
            for (const f of fallbackFacts) {
              if (await persistFact(userId, f.fact, sourceRef, f.confidence, f.tags)) extractedFacts++;
            }
          } else {
            extractionCostUsd = llmResult.costUsd;
            const llmFacts = llmResult.response?.facts ?? [];
            for (const f of llmFacts.slice(0, FACTS_PER_RUN[tier])) {
              if (await persistFact(userId, f.fact, sourceRef, f.confidence, f.tags)) extractedFacts++;
            }
          }
        }
      }
    }

    await MemoryPipelineRun.create({
      userId,
      runId,
      windowStart,
      windowEnd,
      eventTypes,
      tier,
      extractionCostUsd,
      extractedFacts,
      extractedChunks,
      extractionBudgetExceeded,
      dropped,
      droppedReason,
    });
  } catch (err: any) {
    // Fire-and-forget per §7 invariants: a failed run is logged, not
    // thrown — the cron continues to the next user rather than aborting
    // the whole nightly batch over one user's failure.
    logger.error(
      `[memory-pipeline] run failed for user ${userId}: ${err?.message ?? err}`,
    );
  }
}

/**
 * Cron entry point — 02:00 UTC daily per §7. Finds every user with at
 * least one event in the past 24h and runs the pipeline for each.
 */
export async function runMemoryPipelineCron(): Promise<void> {
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000);

  const userIds: Types.ObjectId[] = await Event.distinct("userId", {
    occurredAt: { $gte: windowStart },
  });

  logger.info(`[memory-pipeline] nightly run starting for ${userIds.length} users`);

  for (const uid of userIds) {
    await runMemoryPipelineForUser(String(uid), windowStart, windowEnd);
  }

  logger.info(`[memory-pipeline] nightly run complete`);
}
