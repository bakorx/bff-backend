import cron, { ScheduledTask } from "node-cron";
import { shortQueue, longQueue } from "./queues";
import { logger } from "@/config";
import { services as featuresServices } from "@/features";
export * from "./queues";
export * from "./utils";

let subscriptionExpiryCron: ScheduledTask | null = null;
let creditRechargeCron: ScheduledTask | null = null;
let tokenGcCron: ScheduledTask | null = null;
let pushSweepCron: ScheduledTask | null = null;
let timetableSweepCron: ScheduledTask | null = null;
let publicPreExamQuizSweepCron: ScheduledTask | null = null;
let timetableScrapeCron: ScheduledTask | null = null;
let timetableConfirmCron: ScheduledTask | null = null;
let campaignRecoveryCron: ScheduledTask | null = null;
let studentReverifyCron: ScheduledTask | null = null;
let streakSweepCron: ScheduledTask | null = null;
let weeklyDigestCron: ScheduledTask | null = null;
let redisCleanupCron: ScheduledTask | null = null;
let billingCycleSummaryCron: ScheduledTask | null = null;
let memoryPipelineCron: ScheduledTask | null = null;
let delayedRecCleanupCron: ScheduledTask | null = null;
let livenessCheckCron: ScheduledTask | null = null;
let spotCheckSampleCron: ScheduledTask | null = null;

/**
 * Start the scheduler cron jobs.
 *
 * Short queue — flushed every minute.
 *   Handles: email sends, token cleanup, AI credit warnings,
 *            subscription expiry notifications, payment confirmations.
 *
 * Long queue  — flushed every 5 minutes.
 *   Handles: material processing, AI quiz/flashcard/explanation generation,
 *            subscription expiry sweeps, monthly credit recharges,
 *            bulk newsletter dispatch, nightly token GC.
 *
 * Additionally, three periodic maintenance jobs are enqueued automatically:
 *   • "subscription:expire_sweep"       — daily at 00:00 UTC
 *   • "credits:monthly_recharge"        — 1st of every month at 00:05 UTC
 *   • "tokens:global_cleanup"           — nightly at 02:00 UTC
 *   • "memory:pipeline_run"             — nightly at 02:00 UTC (#26, rec-engine.md §7)
 */
export async function startSchedulers(): Promise<void> {
  try {
  // Register all job handlers
  logger.info("[Scheduler] Scheduling all cron...");

  // --- Subscription expiry sweep: daily at midnight UTC ---
  subscriptionExpiryCron = cron.schedule("0 0 * * *", async () => {
    longQueue.enqueue("subscription:expire_sweep", {});
  }, {timezone: "GMT"});

  // --- Monthly AI credit recharge: 1st of month at 00:05 UTC ---
  creditRechargeCron = cron.schedule(
    "5 0 1 * *",
    async () => {
      longQueue.enqueue("credits:monthly_recharge", {});
    },
    { timezone: "GMT" },
  );

  // --- Nightly token GC: 02:00 UTC ---
  tokenGcCron = cron.schedule(
    "0 2 * * *",
    async () => {
      longQueue.enqueue("tokens:global_cleanup", {});
    },
    { timezone: "GMT" },
  );

  // recommendation:rebuild_profiles and recommendation:generate crons were
  // removed here (issue #220) — both fired nightly into handlers that either
  // didn't exist or were no-op stubs. Replaced by memory:pipeline_run below
  // (#26), the real pipeline the rec-engine.md rebuild describes.

  // --- Memory write pipeline (#26, rec-engine.md §7): 02:00 UTC daily ---
  memoryPipelineCron = cron.schedule(
    "0 2 * * *",
    async () => {
      logger.info("[scheduler] cron fired: memory:pipeline_run");
      longQueue.enqueue("memory:pipeline_run", {});
    },
    { timezone: "GMT" },
  );

  // --- Stale delayed-rec job cleanup (#11, rec-engine.md §11): 03:00 UTC daily ---
  delayedRecCleanupCron = cron.schedule(
    "0 3 * * *",
    async () => {
      logger.info("[scheduler] cron fired: rec:cleanup_stale_delayed");
      longQueue.enqueue("rec:cleanup_stale_delayed", {});
    },
    { timezone: "GMT" },
  );

  // --- External resource liveness check (#22, rec-engine.md §13): 02:00 UTC daily ---
  livenessCheckCron = cron.schedule(
    "0 2 * * *",
    async () => {
      logger.info("[scheduler] cron fired: rec:liveness_check");
      longQueue.enqueue("rec:liveness_check", {});
    },
    { timezone: "GMT" },
  );

  // --- External resource spot-check sample (#22, rec-engine.md §13): weekly. ---
  // §13 says "Weekly" but not a day/time — Sunday 07:00 UTC picked as a low
  // -traffic slot that doesn't collide with any other registered cron.
  spotCheckSampleCron = cron.schedule(
    "0 7 * * 0",
    async () => {
      logger.info("[scheduler] cron fired: rec:spot_check_sample");
      longQueue.enqueue("rec:spot_check_sample", {});
    },
    { timezone: "GMT" },
  );

  // --- Daily invalid push subscription sweep: 01:00 UTC ---
  pushSweepCron = cron.schedule(
    "0 1 * * *",
    async () => {
      logger.info("[scheduler] cron fired: push:sweep_invalid");
      longQueue.enqueue("push:sweep_invalid", {});
    },
    { timezone: "GMT" },
  );

  // --- Exam timetable sweep: daily at 18:00 UTC (6pm Ghana) ---
  // Pinned to evening so 1/3/7-day reminders reliably land the evening before.
  timetableSweepCron = cron.schedule(
    "0 18 * * *",
    async () => {
      logger.info("[scheduler] cron fired: timetable:daily_sweep");
      longQueue.enqueue("timetable:daily_sweep", {});
    },
    { timezone: "GMT" },
  );

  // --- Public pre-exam quiz auto-generation sweep: daily at 06:00 UTC ---
  publicPreExamQuizSweepCron = cron.schedule(
    "0 6 * * *",
    async () => {
      logger.info("[scheduler] cron fired: quiz:public_preexam_sweep");
      longQueue.enqueue("quiz:public_preexam_sweep", {});
    },
    { timezone: "GMT" },
  );

  // --- School timetable scraping: every 3 hours at minute 15 ---
  timetableScrapeCron = cron.schedule(
    "15 */3 * * *",
    async () => {
      logger.info("[scheduler] cron fired: scrape:school_timetable (every-3h)");
      longQueue.enqueue("scrape:school_timetable", {});
    },
    { timezone: "GMT" },
  );

  // --- Morning Day-of Confirmation: 05:00 UTC daily ---
  timetableConfirmCron = cron.schedule(
    "0 5 * * *",
    async () => {
      logger.info("[scheduler] cron fired: scrape:daily_confirmation");
      longQueue.enqueue("scrape:daily_confirmation", {});
    },
    { timezone: "GMT" },
  );

  // --- Campaign dispatch recovery sweep: every 30 minutes ---
  campaignRecoveryCron = cron.schedule(
    "*/30 * * * *",
    async () => {
      longQueue.enqueue("email:campaign:dispatch:recovery", {});
    },
    { timezone: "GMT" },
  );

  // --- Student re-verify sweep: daily at 09:00 UTC ---
  studentReverifyCron = cron.schedule(
    "0 9 * * *",
    async () => {
      longQueue.enqueue("student:reverify_sweep", {});
    },
    { timezone: "GMT" },
  );

  // --- Streak daily sweep: 01:30 UTC (safety net for inactive users) ---
  streakSweepCron = cron.schedule(
    "30 1 * * *",
    async () => {
      longQueue.enqueue("streak:daily_sweep", {});
    },
    { timezone: "GMT" },
  );

  // --- Weekly digest: Monday 08:00 UTC ---
  // Gated on the `weekly_digest_enabled` feature flag so admins can stop
  // the cron at the source. The handler has its own defensive gate too
  // (in case someone enqueues manually from Bull Board).
  weeklyDigestCron = cron.schedule(
    "0 8 * * 1",
    async () => {
      const ok = await featuresServices.isEnabled("weekly_digest_enabled");
      if (!ok) {
        logger.info(
          "[scheduler] weeklyDigest cron skipped: weekly_digest_enabled is off.",
        );
        return;
      }
      logger.info("[scheduler] cron fired: email:weekly_digest");
      longQueue.enqueue("email:weekly_digest", {});
    },
    { timezone: "GMT" },
  );

  // --- Redis Maintenance: Daily at 04:00 UTC ---
  redisCleanupCron = cron.schedule(
    "0 4 * * *",
    async () => {
      logger.info("[scheduler] cron fired: system:redis_cleanup");
      longQueue.enqueue("system:redis_cleanup", {});
    },
    { timezone: "GMT" },
  );

  // --- Billing cycle summary: Daily at 00:45 UTC ---
  // billingCycleSummaryCron = cron.schedule("45 0 * * *", async () => {
  //   logger.info("[scheduler] cron fired: email:billing_cycle_summary");
  //   longQueue.enqueue("email:billing_cycle_summary", {});
  // });

  logger.info("[Scheduler] All cron jobs scheduled successfully.");
} catch (error) {
   logger.error("[Scheduler] Failed to schedule cron jobs", error);
}
}

/** Stop all running cron tasks (useful for graceful shutdown / tests). */
export async function stopSchedulers(): Promise<void> {
  try {
  logger.info("[Scheduler] Stopping cron jobs...");
  subscriptionExpiryCron?.stop();
  subscriptionExpiryCron = null;

  creditRechargeCron?.stop();
  creditRechargeCron = null;

  tokenGcCron?.stop();
  tokenGcCron = null;

  pushSweepCron?.stop();
  pushSweepCron = null;

  timetableSweepCron?.stop();
  timetableSweepCron = null;

  publicPreExamQuizSweepCron?.stop();
  publicPreExamQuizSweepCron = null;

  timetableScrapeCron?.stop();
  timetableScrapeCron = null;

  timetableConfirmCron?.stop();
  timetableConfirmCron = null;

  campaignRecoveryCron?.stop();
  campaignRecoveryCron = null;

  studentReverifyCron?.stop();
  studentReverifyCron = null;

  streakSweepCron?.stop();
  streakSweepCron = null;

  weeklyDigestCron?.stop();
  weeklyDigestCron = null;

  redisCleanupCron?.stop();
  redisCleanupCron = null;

  billingCycleSummaryCron?.stop();
  billingCycleSummaryCron = null;

  memoryPipelineCron?.stop();
  memoryPipelineCron = null;

  delayedRecCleanupCron?.stop();
  delayedRecCleanupCron = null;

  livenessCheckCron?.stop();
  livenessCheckCron = null;

  spotCheckSampleCron?.stop();
  spotCheckSampleCron = null;

  logger.info("[Scheduler] All cron jobs stopped.");
  } catch (error) {
    logger.error("[Scheduler] Failed to stop cron jobs", error);
  }
}

