import { Mongoose } from "mongoose";
import {
  PLAN_PRICES,
  TIER_LIMITS,
  CREDIT_BUNDLES,
  PlanTier,
  PlanDuration,
  DURATION_DAYS,
} from "@/subscriptions";
import { logger } from "@/config";

/**
 * Migration 032: Seed tiered packages and credit bundles.
 * Creates the 9 canonical Package documents (3 tiers × 3 durations) and
 * 3 CreditBundle documents if they do not already exist.
 */
export async function up(mongoose: Mongoose) {
  logger.info("Starting migration: 032_seed_tiered_packages...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("No active DB connection");

  const packagesCollection = db.collection("packages");
  const creditBundlesCollection = db.collection("creditbundles");

  const tiers: PlanTier[] = ["cooked", "cruising", "locked_in"];
  const durations: PlanDuration[] = ["daily", "weekly", "semester"];
  const tierNames: Record<PlanTier, string> = {
    cooked: "Cooked",
    cruising: "Cruising",
    locked_in: "Locked In",
  };

  let packagesSeeded = 0;

  for (const tier of tiers) {
    for (const duration of durations) {
      const existing = await packagesCollection.findOne({
        tier,
        durationType: duration,
      });
      if (existing) continue;

      const priceGHS = PLAN_PRICES[tier][duration];
      const limits = TIER_LIMITS[tier];
      const durationDays = DURATION_DAYS[duration];

      await packagesCollection.insertOne({
        tier,
        durationType: duration,
        priceGHS,
        limits,
        isActive: true,
        // Legacy fields — required by existing schema
        name: `${tierNames[tier]} — ${duration.charAt(0).toUpperCase() + duration.slice(1)}`,
        price: priceGHS,
        duration: durationDays,
        access: "duration",
        isUpgradable: false,
        numberOfQuizzes: 0,
        quizzes: [],
        numberOfCourses: 0,
        courses: [],
        discountPercentage: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      packagesSeeded++;
    }
  }

  logger.info(`Seeded ${packagesSeeded} new package documents.`);

  // Seed credit bundles
  let bundlesSeeded = 0;
  for (const bundle of CREDIT_BUNDLES) {
    const existing = await creditBundlesCollection.findOne({
      name: bundle.name,
    });
    if (existing) continue;

    await creditBundlesCollection.insertOne({
      name: bundle.name,
      priceGHS: bundle.priceGHS,
      credits: bundle.credits,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    bundlesSeeded++;
  }

  logger.info(`Seeded ${bundlesSeeded} new credit bundle documents.`);
  logger.info("Migration 032 complete.");
}

export async function down(mongoose: Mongoose) {
  logger.info(
    "Rolling back migration 032: Removing seeded tiered packages and credit bundles...",
  );

  const db = mongoose.connection.db;
  if (!db) throw new Error("No active DB connection");

  await db.collection("packages").deleteMany({
    tier: { $in: ["cooked", "cruising", "locked_in"] },
  });

  await db.collection("creditbundles").deleteMany({
    name: { $in: ["starter", "standard", "max"] },
  });

  logger.info("Rollback 032 complete.");
}
