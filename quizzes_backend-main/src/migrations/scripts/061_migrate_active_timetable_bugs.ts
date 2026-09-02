import { Mongoose } from "mongoose";
import { ExamTimetable } from "@/learning/models";
import { logger } from "@/config";

/**
 * Migration 061: Migrate active timetable bugs and fix entries.
 *
 * Deduplicates redundant venues on every session of each published
 * ExamTimetable. Two venues are considered duplicates when they resolve to
 * the same student index range, or — when a venue carries no range at all —
 * when they share the same (normalized) name within a session.
 *
 * The index range is read from the `indexStart` / `indexEnd` fields first,
 * because those fields are the runtime source of truth
 * (`resolveVenueForStudentId` never inspects the venue name). Older,
 * not-yet-migrated data may still carry the range embedded in the venue name
 * (e.g. "CENTRAL CAFETERIA (11329893-11329893)"), so we fall back to parsing
 * the name and strip that suffix from the final name either way.
 *
 * This migration does NOT send notifications (the one-off DCIT 426 migration
 * 060 already handled notifications). This migration focuses on data cleanup.
 */

/** Minimal shape of a venue sub-document on an exam session. */
interface IVenueLike {
  venue: string;
  indexStart?: string;
  indexEnd?: string;
}

export async function up(mongoose: Mongoose) {
  logger.info("Starting migration: 061_migrate_active_timetable_bugs...");

  try {
    // 1. Find the active published timetable(s)
    const timetables = await ExamTimetable.find({
      isPublished: true,
    }).lean();

    if (!timetables || timetables.length === 0) {
      logger.info("[Timetable Migration] No active published timetable found");
      return;
    }

    logger.info(
      `[Timetable Migration] Found ${timetables.length} active published timetable(s)`,
    );

    for (const timetable of timetables) {
      logger.info(
        `Processing timetable: ${timetable._id} for ${timetable.semester} ${timetable.academicYear}`,
      );

      // 2. Process each entry in the timetable
      let sessionsFixed = 0;
      let venuesRemoved = 0;

      for (const entry of timetable.entries as Array<{
        courseCode: string;
        sessions?: Array<{ venues?: IVenueLike[] }>;
      }>) {
        if (!entry.sessions || entry.sessions.length === 0) continue;

        for (const session of entry.sessions) {
          if (!session.venues || session.venues.length === 0) continue;

          const original = session.venues;
          const deduped = deduplicateVenues(original);

          const changed =
            deduped.length !== original.length ||
            deduped.some((v, i) => v.venue !== original[i].venue);

          if (!changed) continue;

          venuesRemoved += original.length - deduped.length;
          session.venues = deduped;
          sessionsFixed++;
          logger.info(
            `[Timetable Migration] Cleaned venues in ${entry.courseCode} session (${original.length} -> ${deduped.length})`,
          );
        }
      }

      // 3. Persist if anything changed. The timetables were loaded with
      // `.lean()` (plain objects), so write back with an explicit update
      // rather than `.markModified()` / `.save()`, which only exist on
      // Mongoose documents.
      if (sessionsFixed > 0) {
        await ExamTimetable.updateOne(
          { _id: timetable._id },
          { $set: { entries: timetable.entries } },
        );
        logger.info(
          `[Timetable Migration] Fixed ${sessionsFixed} sessions (removed ${venuesRemoved} duplicate venues) in timetable ${timetable._id}`,
        );
      } else {
        logger.info(
          `[Timetable Migration] No fixes needed for timetable ${timetable._id}`,
        );
      }
    }

    logger.info(
      "[Timetable Migration] Migration completed. All active timetable entries have been reviewed and venue deduplication applied.",
    );
  } catch (error: unknown) {
    logger.error(
      "[Timetable Migration] Migration failed:",
      error instanceof Error ? error.message : error,
    );
    throw error;
  }
}

export async function down(mongoose: Mongoose) {
  logger.info(
    "[Timetable Migration] Down migration: no-op. Deduplication removes redundant venues and cannot be reversed without a backup of the affected timetable(s).",
  );
}

/**
 * Deduplicates a session's venues.
 *
 * Grouping key per venue:
 *  - If it has an index range (from `indexStart`/`indexEnd`, falling back to a
 *    `(XXXX-XXXX)` suffix parsed from the name), the key is that range.
 *  - Otherwise the key is the normalized venue name.
 *
 * One venue is kept per key. When several venues share a key, the one with the
 * longest (most descriptive) name wins. Any embedded `(XXXX-XXXX)` suffix is
 * stripped from the surviving venue name. Original first-seen order is kept.
 */
function deduplicateVenues(venues: IVenueLike[]): IVenueLike[] {
  if (!venues || venues.length <= 1) return venues ?? [];

  const kept = new Map<string, IVenueLike>();
  const order: string[] = [];

  for (const v of venues) {
    const range = venueRange(v);
    const cleanName = stripIndexRange(String(v.venue ?? "")).trim();
    const cleaned: IVenueLike = { ...v, venue: cleanName };

    // Keep the range in the structured fields (the runtime source of truth)
    // even when it only existed in the venue name, so stripping the name does
    // not lose it.
    if (range) {
      if (!cleaned.indexStart) cleaned.indexStart = range.start;
      if (!cleaned.indexEnd) cleaned.indexEnd = range.end;
    }

    const key = range
      ? `range:${range.start}-${range.end}`
      : `name:${cleanName.toUpperCase()}`;

    if (!kept.has(key)) {
      kept.set(key, cleaned);
      order.push(key);
      continue;
    }

    // Same key: keep whichever name is longer / more descriptive.
    const existing = kept.get(key)!;
    if (cleanName.length > String(existing.venue ?? "").length) {
      kept.set(key, cleaned);
    }
  }

  return order.map((key) => kept.get(key)!);
}

/**
 * Resolves the student index range a venue covers. Prefers the structured
 * `indexStart` / `indexEnd` fields (the runtime source of truth) and falls
 * back to a `(XXXX-XXXX)` suffix embedded in the venue name. Returns null when
 * the venue covers no specific range.
 */
function venueRange(v: IVenueLike): { start: string; end: string } | null {
  const fieldStart = normalizeDigits(v.indexStart);
  const fieldEnd = normalizeDigits(v.indexEnd);
  if (fieldStart && fieldEnd) return { start: fieldStart, end: fieldEnd };

  const parsed = extractIndexRange(String(v.venue ?? ""));
  if (parsed) {
    return {
      start: normalizeDigits(parsed.start),
      end: normalizeDigits(parsed.end),
    };
  }

  return null;
}

/** Keeps only digits so "22300439" and "22 300 439" compare equal. */
function normalizeDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

/**
 * Extracts the index range (XXXX-XXXX) from a venue string.
 */
function extractIndexRange(
  venue: string,
): { start: string; end: string } | null {
  const rangeMatch = venue.match(/\((\d+)\s*-\s*(\d+)\)/);
  if (rangeMatch) {
    return { start: rangeMatch[1], end: rangeMatch[2] };
  }
  return null;
}

/**
 * Strips a trailing index range from a venue string.
 * "CENTRAL CAFETERIA (11329893-11329893)" -> "CENTRAL CAFETERIA"
 */
function stripIndexRange(venue: string): string {
  return venue.replace(/\s*\(\d+(?:\s*-\s*\d+)?\)\s*$/, "").trim();
}
