import axios from "axios";
import { Types } from "mongoose";
import { longQueue } from "../queues";
import { logger } from "@/config";
import { User } from "@/users";
import { services as pushServices, utils as pushUtils } from "@/push";
import { ExternalResource } from "@/recommendations";

// ---------------------------------------------------------------------------
// External resource liveness + spot-check crons (#22) — rec-engine.md §13
// "Quality control" / "Liveness cron".
// ---------------------------------------------------------------------------

const HEAD_TIMEOUT_MS = 5000; // §13: "timeout 5s"
const PAGE_SIZE = 100; // §13: "paginated, 100/page"
const RATE_LIMIT_INTERVAL_MS = 60_000 / 100; // §13: "Rate limit: 100 req/min"
const BROKEN_ALERT_THRESHOLD = 0.1; // §13: "> 10% broken today"
const SPOT_CHECK_SAMPLE_SIZE = 5; // §13: "5 random approved resources"
// Matches the admin router's own role gate (see recommendations/routes.ts's
// adminRecommendationsRouter) — same set of roles that can act on these
// resources in the moderation queue.
const ADMIN_ROLES = ["super_admin", "creator", "moderator"] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * §13's "Alert admin" action for both the daily broken-link threshold and
 * the weekly spot-check surfacing. No broadcast-to-all-admins channel
 * existed anywhere in the codebase before this — the closest precedent
 * (src/schedulers/handlers/system.ts's migration notifications) only
 * targets the single admin who triggered the action, which a cron doesn't
 * have. Built from the same real, already-used primitives: a role-based
 * User lookup + push/services.ts's sendToUsers (batched, respects each
 * admin's own notification settings, never throws).
 *
 * Also logged at warn level unconditionally — the durable, always-on half
 * of the alert, independent of whether any admin has push subscriptions.
 */
async function alertAdmins(title: string, body: string, url: string): Promise<void> {
  logger.warn(`[liveness-cron] ${title}: ${body}`);
  try {
    const admins = await User.find({ role: { $in: ADMIN_ROLES } })
      .select("_id")
      .lean();
    const adminIds = admins.map((a) => String(a._id));
    if (adminIds.length === 0) return;

    await pushServices.sendToUsers(
      adminIds,
      pushUtils.pushPayloads.generalNotification(title, body, url),
      "external_resource_health_alert",
    );
  } catch (err: any) {
    logger.error(
      `[liveness-cron] failed to push admin alert: ${err?.message ?? err}`,
    );
  }
}

/** HEAD the URL; true only on a genuine 2xx. Any thrown error (timeout, DNS, connection refused, etc.) counts as dead, matching §13's "non-2xx or timeout" — both mermaid branches lead to the same outcome. */
async function isAlive(url: string): Promise<boolean> {
  try {
    const res = await axios.head(url, {
      timeout: HEAD_TIMEOUT_MS,
      validateStatus: () => true,
    });
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}

/**
 * Daily liveness sweep (§13 "Liveness cron" mermaid flow). Paginates every
 * `status: 'approved'` resource — verified and unverified alike, since a
 * bulk-import resource's first 2xx here is exactly what flips it to
 * `verified: true` (§12: "needs_review flag is set to true until the first
 * liveness cron pass returns 2xx" — see interfaces.ts's IExternalResource
 * doc comment for the full `verified`/`needs_review` reconciliation).
 *
 * Pagination is keyset (`_id > lastId`), not skip/limit: this loop itself
 * mutates the `status: 'approved'` filter as it runs (failing checks flip a
 * resource to `needs_review`), and skip-based pagination would silently
 * drop or re-visit documents once earlier pages shrink the approved set
 * out from under it.
 */
export async function runLivenessCheck(): Promise<void> {
  let lastId: Types.ObjectId | null = null;
  let checked = 0;
  let broken = 0;

  for (;;) {
    const filter: Record<string, unknown> = { status: "approved" };
    if (lastId) filter._id = { $gt: lastId };

    const page: { _id: Types.ObjectId; url: string; verified: boolean }[] =
      await ExternalResource.find(filter)
        .select("_id url verified")
        .sort({ _id: 1 })
        .limit(PAGE_SIZE)
        .lean();

    if (page.length === 0) break;

    for (const resource of page) {
      const alive = await isAlive(resource.url);
      checked++;

      if (alive) {
        if (!resource.verified) {
          await ExternalResource.updateOne(
            { _id: resource._id },
            { $set: { verified: true } },
          );
        }
      } else {
        broken++;
        await ExternalResource.updateOne(
          { _id: resource._id },
          { $set: { status: "needs_review" } },
        );
      }

      // §13: rate limit applies after every check, success or failure alike
      // (both mermaid branches feed the same rate-limit node).
      await sleep(RATE_LIMIT_INTERVAL_MS);
    }

    lastId = page[page.length - 1]._id;
  }

  logger.info(
    `[liveness-cron] checked ${checked} approved resource(s), ${broken} marked needs_review`,
  );

  if (checked > 0 && broken / checked > BROKEN_ALERT_THRESHOLD) {
    const pct = ((broken / checked) * 100).toFixed(1);
    await alertAdmins(
      "External resource link health alert",
      `${broken} of ${checked} approved external resources (${pct}%) failed today's liveness check and were marked needs_review.`,
      "/admin/recommendations/external-resources?status=needs_review",
    );
  }
}

/**
 * Weekly spot-check sampling (§13 "Quality control" table). Picks
 * `SPOT_CHECK_SAMPLE_SIZE` genuinely random currently-approved resources
 * via $sample, stamps `spotCheckedAt`, and alerts admins with the list.
 * Doesn't touch `status` — a resource is not suspected broken just because
 * it was sampled, so it stays fully servable while under re-review.
 *
 * `spotCheckedAt` is not cleared when an admin actually re-reviews it —
 * the doc doesn't describe a resolution step for this (unlike the liveness
 * cron's needs_review, which the existing moderation queue already
 * surfaces and clears via approve/reject). A later run can re-sample the
 * same resource; true random sampling with replacement is what §13 asks
 * for ("5 random approved resources"), not fair rotation.
 */
export async function runSpotCheckSample(): Promise<void> {
  const sample: { _id: Types.ObjectId; title: string; url: string }[] =
    await ExternalResource.aggregate([
      { $match: { status: "approved" } },
      { $sample: { size: SPOT_CHECK_SAMPLE_SIZE } },
      { $project: { title: 1, url: 1 } },
    ]);

  if (sample.length === 0) {
    logger.info("[liveness-cron] spot_check_sample: no approved resources to sample");
    return;
  }

  await ExternalResource.updateMany(
    { _id: { $in: sample.map((r) => r._id) } },
    { $set: { spotCheckedAt: new Date() } },
  );

  const list = sample.map((r) => `- ${r.title} (${r.url})`).join("\n");
  await alertAdmins(
    "Weekly external resource spot-check",
    `${sample.length} random approved external resource(s) selected for re-review:\n${list}`,
    "/admin/recommendations/external-resources?status=approved",
  );
}

export function registerHandlers(): void {
  logger.info("[Liveness Handler] Registering queue handlers...");

  longQueue.register("rec:liveness_check", async () => {
    await runLivenessCheck();
  });

  longQueue.register("rec:spot_check_sample", async () => {
    await runSpotCheckSample();
  });
}
