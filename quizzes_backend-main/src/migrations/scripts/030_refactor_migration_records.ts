import { Migration } from "@/system/models";
import { logger } from "@/config";

/**
 * Migration to refactor existing migration records to the new schema.
 * Sets status to 'success' and populates startTime/endTime from runAt.
 */
export async function up() {
  logger.info("Starting migration: 030_refactor_migration_records...");

  // Update all existing records that don't have a status
  const existingRecords = await Migration.find({ status: { $exists: false } });

  logger.info(`Found ${existingRecords.length} records to refactor.`);

  for (const record of existingRecords) {
    record.status = "success";
    const baseDate = record.runAt || record.createdAt || new Date();
    record.startTime = baseDate;
    record.endTime = baseDate;
    await record.save();
  }

  logger.info("Successfully refactored migration records.");
}

export async function down() {
  // To reverse, we'd remove the new fields, but standard 'Migration' documents
  // in this system don't usually support full rollback of structural metadata.
  logger.info(
    "Down migration for 030: No-op as structural fields are additive.",
  );
}
