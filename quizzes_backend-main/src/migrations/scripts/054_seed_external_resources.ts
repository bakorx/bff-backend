import { Mongoose, Types } from "mongoose";
import * as fs from "fs";
import * as path from "path";
import { logger } from "@/config";

/**
 * Migration 054: Bulk-import the initial external resource library.
 * rec-engine.md §12 "Bulk imports — admin-only path for seeding the
 * initial library." §13's "Quality control" table.
 *
 * Reads src/migrations/seeds/external-resources.json and inserts each
 * entry auto-approved per §12 ("bulk_import -> auto-approved on insert
 * with moderatedBy: SYSTEM, moderatedAt: createdAt"), but unverified
 * ("The needs_review flag is set to true until the first liveness cron
 * pass returns 2xx for the URL") — modeled as `verified: false` here (see
 * src/recommendations/interfaces.ts's IExternalResource doc comment for
 * why `verified` is a separate field from the `status` enum's
 * `needs_review` value).
 *
 * The seed file ships EMPTY in this repo. §15 estimates a ~200-resource
 * initial library, but that's real content curation (finding, vetting,
 * and tagging actual YouTube videos / articles / PDFs for BECE/WASSCE/
 * undergrad topics) — not something to fabricate here. This migration is
 * the real, working import mechanism, ready the moment the team supplies
 * real curated resources in the seed file's documented shape:
 *
 *   [
 *     {
 *       "title": "Derivatives: the chain rule explained",
 *       "url": "https://www.youtube.com/watch?v=REPLACE_WITH_REAL_ID",
 *       "source": "youtube",              // youtube | pdf | article | file
 *       "topicTags": ["math", "calculus", "derivatives"],
 *       "difficulty": "undergrad",        // bece | wassce | undergrad | general
 *       "language": "en"                  // optional, defaults to "en"
 *     }
 *   ]
 *
 * (No README.md alongside — this repo's .gitignore excludes *.MD, so a
 * separate seeds/README.md would never actually ship. This comment block
 * is the shipped documentation.)
 *
 * Rollback: db.externalresources.deleteMany({ sourceType: 'bulk_import' })
 */

// Same sentinel as SYSTEM_MODERATOR_ID in src/recommendations/models.ts —
// duplicated as a literal here rather than imported, matching this
// codebase's migration convention of using the raw driver against
// collections rather than importing live model code (migrations are
// treated as immutable history; importing live model definitions would
// couple a past migration to future schema changes).
const SYSTEM_MODERATOR_ID = "000000000000000000000000";

interface SeedResource {
  title: string;
  url: string;
  source: "youtube" | "pdf" | "article" | "file";
  topicTags: string[];
  difficulty: "bece" | "wassce" | "undergrad" | "general";
  language?: string;
}

export async function up(mongoose: Mongoose) {
  logger.info("[054] Seeding external resource library from JSON seed file...");

  const seedPath = path.join(__dirname, "../seeds/external-resources.json");
  if (!fs.existsSync(seedPath)) {
    logger.info(`[054] No seed file found at ${seedPath} — nothing to import.`);
    return;
  }

  const resources = JSON.parse(
    fs.readFileSync(seedPath, "utf-8"),
  ) as SeedResource[];

  if (resources.length === 0) {
    logger.info("[054] Seed file is empty — nothing to import yet.");
    return;
  }

  const db = mongoose.connection.db;
  if (!db) {
    logger.info("[054] No db object available. Ensure mongoose is connected.");
    return;
  }

  const now = new Date();
  const docs = resources.map((r) => ({
    title: r.title,
    url: r.url,
    source: r.source,
    topicTags: r.topicTags,
    difficulty: r.difficulty,
    language: r.language ?? "en",
    status: "approved",
    submittedBy: null,
    moderatedBy: new Types.ObjectId(SYSTEM_MODERATOR_ID),
    moderatedAt: now,
    sourceType: "bulk_import",
    submitterOptIn: true,
    verified: false,
    viewCount: 0,
    upvotes: 0,
    createdAt: now,
  }));

  const result = await db
    .collection("externalresources")
    .insertMany(docs, { ordered: false });
  logger.info(`[054] Imported ${result.insertedCount} external resources.`);
}

export async function down(mongoose: Mongoose) {
  const db = mongoose.connection.db;
  if (!db) return;
  const result = await db
    .collection("externalresources")
    .deleteMany({ sourceType: "bulk_import" });
  logger.info(`[054] Rollback: removed ${result.deletedCount} bulk-imported resources.`);
}
