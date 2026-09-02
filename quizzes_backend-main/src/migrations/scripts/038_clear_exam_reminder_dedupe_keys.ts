import { Mongoose } from "mongoose";
import { redisConnection } from "@/config";
import { logger } from "@/config";

export const dependsOn = ["037_relax_migration_uniqueness_and_backfill_ids"];

const DEDUPE_PATTERN = "dedupe:push:exam_reminder:*";
const SCAN_COUNT = 500;

export async function up(_mongoose: Mongoose) {
  logger.info("Starting migration: 038_clear_exam_reminder_dedupe_keys...");

  let cursor = "0";
  let deletedCount = 0;
  let scannedBatches = 0;

  do {
    const [nextCursor, keys] = await redisConnection.scan(
      cursor,
      "MATCH",
      DEDUPE_PATTERN,
      "COUNT",
      SCAN_COUNT,
    );
    cursor = nextCursor;
    scannedBatches += 1;

    if (keys.length > 0) {
      // UNLINK is non-blocking in Redis and safer for larger key sets.
      const removed = await redisConnection.unlink(...keys);
      deletedCount += removed;
    }
  } while (cursor !== "0");

  logger.info(
    `[038] Completed. Pattern=${DEDUPE_PATTERN}, deleted=${deletedCount}, scanBatches=${scannedBatches}`,
  );
}

export async function down(_mongoose: Mongoose) {
  logger.info(
    "Down migration for 038: No-op (deleted Redis dedupe keys cannot be restored).",
  );
}
