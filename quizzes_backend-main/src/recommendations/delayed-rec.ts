import { Types } from "mongoose";
import { longQueue } from "@/schedulers";
import { logger } from "@/config";

// ---------------------------------------------------------------------------
// 24h-after-flag cron (#11) — rec-engine.md §11. Write-side: flags a source
// event for a delayed system-tier rec, 24h out. The worker side (idempotency
// check, tier re-check, generation, socket push) lives in
// src/schedulers/handlers/delayed-rec.ts.
// ---------------------------------------------------------------------------

const DELAY_MS = 24 * 60 * 60 * 1000;

/**
 * Called from the two auto-flag sources (§11: "Quiz fail", "Session
 * abandoned") right after their emit() call succeeds. Fire-and-forget by
 * contract, same as emit() itself — never throws into the caller.
 *
 * originalEventId is the real Event document's _id (from the emit() call
 * that just succeeded) — the idempotency key the worker checks against.
 * A deterministic BullMQ jobId (derived from it) additionally prevents the
 * queue itself from double-enqueueing the same flag.
 */
export async function flagForDelayedRec(
  userId: string,
  surface: string,
  originalEventId: Types.ObjectId | string,
  topic?: string,
): Promise<void> {
  try {
    await longQueue.enqueue(
      "rec:queue_delayed",
      { userId, surface, topic, originalEventId: String(originalEventId) },
      3,
      `rec:delayed:${originalEventId}`,
      DELAY_MS,
    );
  } catch (err: any) {
    logger.error(
      `[delayed-rec] failed to enqueue for event ${originalEventId}: ${err?.message ?? err}`,
    );
  }
}
