import { Mongoose } from "mongoose";
import { ExamTimetable } from "@/learning/models";
import { logger } from "@/config";

/**
 * Migration 063: Remove fabricated timetable sessions.
 *
 * Background: when the university source had no exam date for a course (e.g.
 * take-home exams such as DCIT 426, or not-yet-scheduled papers), the old
 * `parseScheduledDateTime` fell back to `new Date()`. Because session de-dup
 * keyed on the exact `scheduledAt`, every periodic sync fabricated a *new*
 * timestamp and appended another duplicate session under the same label.
 *
 * IMPORTANT policy revision: a session whose only venue is the placeholder
 * "Assigned by Department" is NOT fabricated — it simply has no venue
 * published yet, and it must stay visible (the UI marks it as "venue not
 * assigned yet"). Fabrication is identified by DUPLICATION instead: a session
 * is removed only when it shares its (course entry, label) group with at
 * least one other session AND has no real venue. Real schedules do not
 * accumulate repeated same-label sessions; the fabrication bug did (13 copies
 * of DCIT 426 "MAIN" in ~33h).
 *
 * Guarantees:
 * - Sessions with at least one real venue are never touched.
 * - Single sessions (only one for their label) are never touched, even when
 *   their only venue is "Assigned by Department".
 * - If removing fabricated duplicates empties an entry, the entry is dropped;
 *   the course and enrollments are untouched, and the next sync recreates the
 *   entry once the university publishes a real date.
 *
 * Idempotent: re-running finds nothing further to remove.
 */

/** Normalized name of the placeholder venue that means "no venue assigned". */
const TBD_VENUE_NAME = "assigned by department";

interface IVenueLike {
  venue: string;
  indexStart?: string;
  indexEnd?: string;
}

interface ISessionLike {
  sessionId?: string;
  label?: string;
  scheduledAt?: Date | string;
  venues?: IVenueLike[];
}

interface IEntryLike {
  courseCode: string;
  courseName?: string;
  sessions?: ISessionLike[];
}

/**
 * Normalizes a venue name for comparison: strips a trailing "(XXXX-XXXX)" or
 * "(XXXX)" index-range suffix, trims, and lowercases. This matches both stored
 * shapes — a bare "Assigned by Department" with separate indexStart/indexEnd
 * fields, and a "Assigned by Department (11014444-11014444)" combined name.
 */
function normalizeVenueName(venue: string): string {
  return venue
    .replace(/\s*\(\d+(?:\s*-\s*\d+)?\)\s*$/, "")
    .trim()
    .toLowerCase();
}

/** True when a single venue is the TBD placeholder (or has no name at all). */
function isTbdVenue(venue: IVenueLike): boolean {
  const name = normalizeVenueName(String(venue?.venue ?? ""));
  return name === "" || name === TBD_VENUE_NAME;
}

/**
 * True when a session has at least one real (non-placeholder) venue. Sessions
 * with a real venue are always kept. Sessions without one are legitimate too
 * (venue not published yet) — they are only removed when they are part of a
 * duplicated same-label group, which is the fabrication signature.
 */
function hasRealVenue(session: ISessionLike): boolean {
  const venues = session.venues ?? [];
  if (venues.length === 0) return false;
  return venues.some((v) => !isTbdVenue(v));
}

/** Sessions dedupe/label-match on this key; missing labels count as "MAIN". */
function labelKey(session: ISessionLike): string {
  return (session.label || "MAIN").trim().toUpperCase();
}

export async function up(mongoose: Mongoose) {
  logger.info(
    "Starting migration: 063_remove_fabricated_timetable_sessions...",
  );

  try {
    const timetables = await ExamTimetable.find({ isPublished: true }).lean();

    if (!timetables || timetables.length === 0) {
      logger.info("[063] No published timetables found; nothing to clean.");
      return;
    }

    logger.info(`[063] Found ${timetables.length} published timetable(s)`);

    let totalSessionsRemoved = 0;
    let totalEntriesRemoved = 0;
    let timetablesChanged = 0;

    for (const timetable of timetables) {
      const entries = (timetable.entries ?? []) as IEntryLike[];
      const cleanedEntries: IEntryLike[] = [];
      let sessionsRemoved = 0;
      let entriesRemoved = 0;

      for (const entry of entries) {
        const sessions = entry.sessions ?? [];

        // Leave already-empty entries alone (not produced by this bug).
        if (sessions.length === 0) {
          cleanedEntries.push(entry);
          continue;
        }

        // Count sessions per label to detect the fabrication signature:
        // repeated same-label sessions under one course entry.
        const labelCounts = new Map<string, number>();
        for (const session of sessions) {
          const key = labelKey(session);
          labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
        }

        const keptSessions: ISessionLike[] = [];
        let removedHere = 0;
        for (const session of sessions) {
          const isDuplicatedLabel = (labelCounts.get(labelKey(session)) ?? 0) >= 2;
          if (isDuplicatedLabel && !hasRealVenue(session)) {
            // Fabricated duplicate with no real venue — remove it. Sessions
            // with a real venue survive even inside duplicated groups.
            removedHere++;
          } else {
            keptSessions.push(session);
          }
        }

        if (removedHere === 0) {
          cleanedEntries.push(entry);
          continue;
        }

        sessionsRemoved += removedHere;

        if (keptSessions.length === 0) {
          // Every session for this course was a fabricated duplicate — drop
          // the entry. Course + enrollments stay; the next sync recreates it
          // once a real date is published.
          entriesRemoved++;
          logger.info(
            `[063] Removing entry ${entry.courseCode} (${removedHere} fabricated duplicate session(s)) from timetable ${timetable._id}`,
          );
          continue;
        }

        cleanedEntries.push({ ...entry, sessions: keptSessions });
        logger.info(
          `[063] ${entry.courseCode}: removed ${removedHere} fabricated duplicate session(s), kept ${keptSessions.length}`,
        );
      }

      if (sessionsRemoved > 0 || entriesRemoved > 0) {
        // Timetables were loaded with `.lean()` (plain objects), so write back
        // with an explicit update rather than `.save()`.
        await ExamTimetable.updateOne(
          { _id: timetable._id },
          { $set: { entries: cleanedEntries } },
        );
        timetablesChanged++;
        totalSessionsRemoved += sessionsRemoved;
        totalEntriesRemoved += entriesRemoved;
        logger.info(
          `[063] Timetable ${timetable._id} (${timetable.semester} ${timetable.academicYear}): removed ${sessionsRemoved} fabricated session(s), ${entriesRemoved} emptied entry/entries`,
        );
      }
    }

    logger.info(
      `[063] Migration completed. Removed ${totalSessionsRemoved} fabricated session(s) and ${totalEntriesRemoved} emptied entry/entries across ${timetablesChanged} timetable(s).`,
    );
  } catch (error: unknown) {
    logger.error(
      "[063] Migration failed:",
      error instanceof Error ? error.message : error,
    );
    throw error;
  }
}

export async function down(mongoose: Mongoose) {
  logger.info(
    "[063] Down migration: no-op. Removed fabricated sessions cannot be restored without a backup, and they will be recreated correctly by sync once the university publishes real dates.",
  );
}
