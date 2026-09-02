import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 053: Clean up deprecated StudyPartnerSession collection.
 *
 * Drops the legacy `studypartnersessions` collection if it exists in the database.
 */
export async function up(mongoose: Mongoose) {
  logger.info("Starting migration: 053_cleanup_legacy_study_partner_sessions...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("No active DB connection");

  const collections = await db.listCollections({ name: "studypartnersessions" }).toArray();
  if (collections.length > 0) {
    await db.collection("studypartnersessions").drop();
    logger.info("Dropped legacy 'studypartnersessions' collection.");
  } else {
    logger.info("Legacy 'studypartnersessions' collection does not exist; skipping.");
  }

  logger.info("Migration 053 complete.");
}

export async function down(mongoose: Mongoose) {
  logger.info("Rollback 053: Dropped collection cannot be restored.");
}
