import { longQueue, Job } from "../queues";
import { logger } from "@/config";
import { publishers } from "@/socket";
import * as eventServices from "@/events/services";
import { DelayedRecFlag, getRecommendationSet } from "@/recommendations";

// ---------------------------------------------------------------------------
// 24h-after-flag cron (#11) worker — rec-engine.md §11.
// ---------------------------------------------------------------------------

export function registerHandlers(): void {
  logger.info("[Delayed Rec Handler] Registering queue handlers...");

  longQueue.register("rec:queue_delayed", async (job: Job) => {
    const { userId, surface, originalEventId } = job.payload as {
      userId: string;
      surface: string;
      topic?: string;
      originalEventId: string;
    };

    // Idempotency (§11): "Same originalEventId cannot fire twice." Checked
    // before doing any work — the deterministic BullMQ jobId (see
    // recommendations/delayed-rec.ts) already stops duplicate enqueues;
    // this additionally guards against a manual replay of the same event.
    const alreadyProcessed = await DelayedRecFlag.findOne({
      originalEventId,
    }).lean();
    if (alreadyProcessed) {
      logger.info(
        `[delayed-rec] originalEventId=${originalEventId} already processed, skipping`,
      );
      return;
    }

    // System tier only (§11: "premium users get real-time recs, no delay
    // needed") — the user's tier may have changed in the 24h since this
    // was flagged, so it's re-checked now, not trusted from flag time.
    const tier = await eventServices.resolveUserTier(userId);
    if (tier !== "free") {
      logger.info(
        `[delayed-rec] user ${userId} is now '${tier}' (not free) — skipping delayed rec for event ${originalEventId}`,
      );
      return;
    }

    const recSet = await getRecommendationSet(userId, surface);
    publishers.recDelayed({ userId, recSet });

    // Recorded AFTER a successful push, not before generation — a
    // transient failure during generation should still be retryable by
    // BullMQ's own attempts mechanism, not permanently blocked by an
    // early claim. The findOne check above plus the unique index on
    // originalEventId still catch a genuine duplicate/replay.
    try {
      await DelayedRecFlag.create({ originalEventId, userId, surface });
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
      // Lost a rare race against a concurrent replay of the same event —
      // the push already happened once above; nothing more to do.
    }
  });

  // §11 invariant: "Stale jobs (older than 7 days, never fired) are
  // cleaned up by a daily cron." BullMQ's own queue.clean() against the
  // "delayed" job state — a normal flag is only ever delayed 24h, so
  // anything still sitting delayed past 7 days means it was never
  // processed (worker downtime, a stuck connection, etc.).
  longQueue.register("rec:cleanup_stale_delayed", async () => {
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const removed = await longQueue.queue.clean(SEVEN_DAYS_MS, 1000, "delayed");
    logger.info(
      `[delayed-rec] cleanup_stale_delayed removed ${removed.length} stale job(s)`,
    );
  });
}
