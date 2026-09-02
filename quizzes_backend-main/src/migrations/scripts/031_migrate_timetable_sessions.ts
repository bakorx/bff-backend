import { Mongoose } from "mongoose";
import { ExamTimetable } from "@/learning/models";
import { nanoid } from "nanoid";
import { logger } from "@/config";

/**
 * Migration 031: Migrate Timetable Sessions.
 * Migrates legacy singular timetable entries to the new multi-session array structure.
 */
export async function up(mongoose: Mongoose) {
  logger.info("Starting migration: 031_migrate_timetable_sessions...");

  const timetables = await ExamTimetable.find({});
  let migratedEntriesCount = 0;
  let timetablesUpdatedCount = 0;

  for (const timetable of timetables) {
    let updated = false;

    // We cast to any because the TS interface no longer has legacy fields,
    // but the actual MongoDB documents still have them.
    for (const entry of timetable.entries as any[]) {
      // If sessions is missing or empty, and we have legacy fields, migrate them
      const hasSessions = entry.sessions && entry.sessions.length > 0;
      const hasLegacyField = entry.scheduledAt || entry.venue;

      if (!hasSessions && hasLegacyField) {
        entry.sessions = [
          {
            sessionId: nanoid(),
            label: "Main Session",
            scheduledAt: entry.scheduledAt || new Date(),
            venues: [
              {
                venue: entry.venue || "TBD",
                indexStart: entry.indexStart,
                indexEnd: entry.indexEnd,
              },
            ],
            durationMinutes: entry.durationMinutes || 120,
          },
        ];

        migratedEntriesCount++;
        updated = true;
      }
    }

    if (updated) {
      timetable.markModified("entries");
      await timetable.save();
      timetablesUpdatedCount++;
    }
  }

  logger.info(
    `Successfully migrated ${migratedEntriesCount} entries across ${timetablesUpdatedCount} timetables.`,
  );
}

export async function down(mongoose: Mongoose) {
  logger.info(
    "Down migration for 031: No-op as structural fields are additive and legacy fields remain in DB.",
  );
}
