import { Mongoose } from "mongoose";
import { randomBytes } from "crypto";
import { logger } from "@/config";

/**
 * Migration 013: Backfill existing Waitlist + NewsletterSubscriber records
 * into the new unified `contacts` collection.
 *
 * Strategy:
 *  1. Iterate all Waitlist entries → upsert as Contact with isWaitlist=true.
 *  2. Iterate all NewsletterSubscriber entries → upsert Contact, setting
 *     newsletter lane fields. If the email already exists (from step 1),
 *     we just add the newsletter lane flags to the existing Contact.
 *
 * Idempotent: safe to re-run. Uses $setOnInsert for initial defaults and
 * $set only for the fields we own from each source.
 */
export async function up(mongoose: Mongoose) {
  logger.info("[013] Migrating Waitlist + NewsletterSubscriber → contacts…");
  const db = mongoose.connection.db;
  if (!db) throw new Error("[013] No db connection");

  const waitlistsCol = db.collection("waitlists");
  const newsletterCol = db.collection("newslettersubscribers");
  const contactsCol = db.collection("contacts");

  // Ensure unique index on email exists in contacts collection
  await contactsCol.createIndex({ email: 1 }, { unique: true });

  let wInserted = 0,
    wUpdated = 0;
  let nInserted = 0,
    nUpdated = 0;

  // ── Step 1: Waitlist → contacts ──────────────────────────────────────────
  const waitlistCursor = waitlistsCol.find({});
  for await (const entry of waitlistCursor) {
    const email = (entry.email ?? "").toLowerCase().trim();
    if (!email) continue;

    const result = await contactsCol.updateOne(
      { email },
      {
        $setOnInsert: {
          email,
          source: "landing_hero",
          isNewsletter: false,
          newsletterStatus: "pending",
          unsubscribeToken: randomBytes(32).toString("hex"),
          createdAt: entry.createdAt ?? new Date(),
        },
        $set: {
          name: entry.name,
          university: entry.university,
          universityId: entry.universityId,
          isWaitlist: !entry.isDeleted,
          waitlistStatus: entry.isDeleted ? "removed" : "active",
          waitlistJoinedAt: entry.createdAt ?? new Date(),
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );

    if (result.upsertedCount) wInserted++;
    else wUpdated++;
  }
  logger.info(
    `[013] Waitlist: inserted ${wInserted}, updated ${nUpdated} existing contacts`,
  );

  // ── Step 2: NewsletterSubscriber → contacts ──────────────────────────────
  const newsletterCursor = newsletterCol.find({});
  for await (const sub of newsletterCursor) {
    const email = (sub.email ?? "").toLowerCase().trim();
    if (!email) continue;

    const result = await contactsCol.updateOne(
      { email },
      {
        $setOnInsert: {
          email,
          isWaitlist: false,
          waitlistStatus: "active",
          createdAt: sub.createdAt ?? new Date(),
        },
        $set: {
          source: sub.source ?? "landing_hero",
          isNewsletter: sub.status === "active" || sub.status === "pending",
          newsletterStatus: sub.status ?? "pending",
          confirmationToken: sub.confirmationToken,
          confirmedAt: sub.confirmedAt,
          unsubscribeToken:
            sub.unsubscribeToken ?? randomBytes(32).toString("hex"),
          unsubscribedAt: sub.unsubscribedAt,
          bouncedAt: sub.bouncedAt,
          bounceReason: sub.bounceReason,
          subscribedAt: sub.subscribedAt ?? sub.createdAt ?? new Date(),
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );

    if (result.upsertedCount) nInserted++;
    else nUpdated++;
  }
  logger.info(
    `[013] Newsletter: inserted ${nInserted}, updated ${nUpdated} existing contacts`,
  );
  logger.info("[013] Migration complete.");
}
