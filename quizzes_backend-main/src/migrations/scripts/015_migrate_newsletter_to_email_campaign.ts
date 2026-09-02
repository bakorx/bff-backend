import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 015: Migrate NewsletterCampaign + NewsletterImage
 *                → EmailCampaign + EmailCampaignImage.
 *
 * Strategy:
 *  1. Copy all documents from `newslettercampaigns` → `emailcampaigns`,
 *     transforming the schema:
 *     - Remove `targetAudience` field (replaced by `audienceFilter`).
 *     - Add new fields with defaults: campaignType, audience, stats extensions,
 *       isSystemGenerated, isTest.
 *     - Map `status` values that are still valid; keep all others as-is.
 *  2. Copy all documents from `newsletterimages` → `emailcampaignimages`,
 *     updating the `campaignId` reference string (no ID change needed — it is
 *     an ObjectId pointing at the same document, now in a new collection).
 *
 * Idempotent: safe to re-run. Uses upsert on `_id` for both collections.
 *
 * ⚠️  The original `newslettercampaigns` and `newsletterimages` collections
 *     are NOT dropped here. Run a follow-up cleanup migration only after
 *     confirming the app is stable on the new collections.
 */
export async function up(mongoose: Mongoose) {
  logger.info(
    "[015] Migrating NewsletterCampaign + NewsletterImage → EmailCampaign + EmailCampaignImage…",
  );

  const db = mongoose.connection.db;
  if (!db) throw new Error("[015] No db connection");

  const collections = (await db.listCollections().toArray()).map((c) => c.name);

  // ── Step 1: newslettercampaigns → emailcampaigns ──────────────────────────

  if (!collections.includes("newslettercampaigns")) {
    logger.info(
      "[015] 'newslettercampaigns' collection not found — skipping campaign migration.",
    );
  } else {
    const srcCampaigns = db.collection("newslettercampaigns");
    const dstCampaigns = db.collection("emailcampaigns");

    // Ensure index compatibility before bulk insert
    await dstCampaigns.createIndex({ status: 1 });
    await dstCampaigns.createIndex({ createdAt: -1 });
    await dstCampaigns.createIndex({ campaignType: 1, status: 1 });
    await dstCampaigns.createIndex({ audience: 1, status: 1 });
    await dstCampaigns.createIndex({ scheduledFor: 1, status: 1 });
    await dstCampaigns.createIndex({ blogPostId: 1 });
    await dstCampaigns.createIndex({
      "audienceFilter.universityId": 1,
      status: 1,
    });
    await dstCampaigns.createIndex({
      "audienceFilter.departmentId": 1,
      status: 1,
    });
    await dstCampaigns.createIndex({ "audienceFilter.roles": 1, status: 1 });

    const total = await srcCampaigns.countDocuments();
    logger.info(`[015] Found ${total} newsletter campaigns to migrate.`);

    let inserted = 0;
    let skipped = 0;

    const cursor = srcCampaigns.find({});
    for await (const doc of cursor) {
      // Remove targetAudience; build audienceFilter from it if present
      const { targetAudience, ...rest } = doc;

      // Derive a sensible audienceFilter from the old targetAudience array
      const audiences: string[] = Array.isArray(targetAudience)
        ? targetAudience
        : ["all"];
      const includeContacts =
        audiences.includes("all") ||
        audiences.includes("waitlist") ||
        audiences.includes("newsletter");
      const includeUsers =
        audiences.includes("all") || audiences.includes("users");

      const contactLanes: Record<string, boolean> = {};
      if (audiences.includes("all") || audiences.includes("waitlist")) {
        contactLanes.waitlist = true;
      }
      if (audiences.includes("all") || audiences.includes("newsletter")) {
        contactLanes.newsletter = true;
      }

      const audienceFilter = {
        includeContacts,
        includeUsers,
        contactLanes,
        contactStatus: {
          waitlistStatus: ["active"],
          newsletterStatus: ["active"],
        },
        excludeUnsubscribed: true,
        excludeBounced: true,
      };

      const transformed = {
        ...rest,
        // New required fields with defaults
        campaignType: "newsletter",
        audience: "broadcast",
        isSystemGenerated: false,
        isTest: false,
        // Migrate stats — keep existing sent/failed, add new counters
        stats: {
          sent: doc.stats?.sent ?? 0,
          failed: doc.stats?.failed ?? 0,
          bounced: 0,
          opened: 0,
          clicked: 0,
          unsubscribed: 0,
          openRate: 0,
          clickRate: 0,
          bounceRate: 0,
        },
        // Audience filter derived from old targetAudience
        audienceFilter,
      };

      const result = await dstCampaigns.updateOne(
        { _id: doc._id },
        { $setOnInsert: transformed },
        { upsert: true },
      );

      if (result.upsertedCount) inserted++;
      else skipped++;
    }

    logger.info(
      `[015] EmailCampaign: inserted ${inserted}, skipped ${skipped} (already migrated).`,
    );
  }

  // ── Step 2: newsletterimages → emailcampaignimages ────────────────────────

  if (!collections.includes("newsletterimages")) {
    logger.info(
      "[015] 'newsletterimages' collection not found — skipping image migration.",
    );
  } else {
    const srcImages = db.collection("newsletterimages");
    const dstImages = db.collection("emailcampaignimages");

    await dstImages.createIndex({ createdAt: -1 });
    await dstImages.createIndex({ campaignId: 1, createdAt: -1 });

    const total = await srcImages.countDocuments();
    logger.info(`[015] Found ${total} newsletter images to migrate.`);

    let inserted = 0;
    let skipped = 0;

    const cursor = srcImages.find({});
    for await (const doc of cursor) {
      // campaignId is an ObjectId — it still points to the same _id that is
      // now in emailcampaigns (same _id was preserved in Step 1).
      const result = await dstImages.updateOne(
        { _id: doc._id },
        { $setOnInsert: doc },
        { upsert: true },
      );

      if (result.upsertedCount) inserted++;
      else skipped++;
    }

    logger.info(
      `[015] EmailCampaignImage: inserted ${inserted}, skipped ${skipped} (already migrated).`,
    );
  }

  logger.info("[015] Migration complete.");
}
