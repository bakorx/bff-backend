import { Mongoose } from "mongoose";
import { UserCourseEnrollment, ExamTimetable } from "@/learning/models";
import { normalizeSemester, normalizeAcademicYear } from "@/learning/utils";
import { logger } from "@/config";

/**
 * Migration 057: Standardize Semester and Academic Years.
 * Normalizes all legacy variations (e.g. "2025/2026", "sem 1", "Semester 1, 2025/2026", "1", "2")
 * in UserCourseEnrollment and ExamTimetable to canonical "Semester 1" / "Semester 2" and "YYYY-YYYY".
 */
export async function up(mongoose: Mongoose) {
  logger.info("Starting migration: 057_standardize_semester_and_academic_years...");

  // 1. Standardize UserCourseEnrollment records safely without deletions
  const enrollments = await UserCourseEnrollment.find({});
  let enrollmentsUpdatedCount = 0;

  for (const doc of enrollments) {
    const rawSem = doc.semester;
    const rawYear = doc.academicYear;

    const normSem = normalizeSemester(rawSem);
    const normYear = normalizeAcademicYear(rawYear);

    let needsSave = false;

    if (rawSem !== normSem) {
      doc.semester = normSem;
      needsSave = true;
    }

    if (rawYear !== normYear) {
      doc.academicYear = normYear;
      needsSave = true;
    }

    // Safely ensure status is present
    if (!doc.status) {
      doc.status = "active";
      needsSave = true;
    }

    if (needsSave) {
      try {
        await doc.save();
        enrollmentsUpdatedCount++;
      } catch (err: any) {
        // If unique index collides with an already existing canonical record,
        // mark this duplicate record as completed/archived to safely preserve it.
        if (err.code === 11000) {
          await UserCourseEnrollment.updateOne(
            { _id: doc._id },
            {
              $set: {
                status: "completed",
                semester: normSem,
                academicYear: normYear,
              },
            },
          );
          enrollmentsUpdatedCount++;
        } else {
          logger.warn(
            `[Migration 057] Could not save enrollment ${doc._id}: ${err.message}`,
          );
        }
      }
    }
  }

  // 2. Standardize ExamTimetable documents and sub-entries
  const timetables = await ExamTimetable.find({});
  let timetablesUpdatedCount = 0;

  for (const timetable of timetables) {
    let updated = false;

    const normTopSem = normalizeSemester(timetable.semester);
    const normTopYear = normalizeAcademicYear(timetable.academicYear);

    if (timetable.semester !== normTopSem) {
      timetable.semester = normTopSem;
      updated = true;
    }
    if (timetable.academicYear !== normTopYear) {
      timetable.academicYear = normTopYear;
      updated = true;
    }

    if (Array.isArray(timetable.entries)) {
      for (const entry of timetable.entries) {
        const normEntrySem = normalizeSemester(entry.semester || normTopSem);
        const normEntryYear = normalizeAcademicYear(entry.academicYear || normTopYear);

        if (entry.semester !== normEntrySem) {
          entry.semester = normEntrySem;
          updated = true;
        }
        if (entry.academicYear !== normEntryYear) {
          entry.academicYear = normEntryYear;
          updated = true;
        }
      }
    }

    if (updated) {
      timetable.markModified("entries");
      await timetable.save();
      timetablesUpdatedCount++;
    }
  }

  logger.info(
    `Migration 057 complete: ${enrollmentsUpdatedCount} enrollments normalized/repaired, ${timetablesUpdatedCount} timetables normalized.`,
  );
}
