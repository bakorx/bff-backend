import { Mongoose, Types } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 028: Standardize and Split Course Codes.
 *
 * 1. Standardizes all course codes to "PREFIX NUMBER" format (e.g. DCIT 401).
 * 2. Splits combined codes like "PHIL310/314" into separate course records.
 * 3. Merges duplicates and duplicates content (quizzes, materials, etc.) for split courses.
 * 4. Updates all ExamTimetable entries.
 */
export async function up(mongoose: Mongoose) {
  const db = mongoose.connection.db;
  if (!db) throw new Error("[028] No db connection");

  logger.info("[028] Starting course code standardization and splitting...");

  const expandCourseCodes = (rawCode: string): string[] => {
    if (!rawCode) return [];
    const segments = rawCode.split("/");
    const results: string[] = [];
    let lastPrefix = "";
    for (const segment of segments) {
      const trimmed = segment.trim().toUpperCase().replace(/\s+/g, "");
      if (!trimmed) continue;
      const match = trimmed.match(/^([A-Z]+)?(\d+.*)$/);
      if (match) {
        const prefix = match[1] || lastPrefix;
        const number = match[2];
        if (prefix) {
          results.push(`${prefix} ${number}`);
          lastPrefix = prefix;
        } else {
          results.push(trimmed);
        }
      } else {
        results.push(trimmed);
      }
    }
    return [...new Set(results)];
  };

  const allCourses = await db
    .collection("courses")
    .find({ isDeleted: { $ne: true } })
    .toArray();
  const courseIdMapping: Record<string, string[]> = {}; // oldId -> [newIds]
  const processedNewCodes: Record<string, string> = {}; // code -> id

  // Phase 1: Identify renames and splits
  for (const course of allCourses) {
    const expanded = expandCourseCodes(course.code);
    const standardizedOriginal = expanded.find(
      (c) => c.replace(/\s+/g, "") === course.code.replace(/\s+/g, ""),
    );

    // If we have multiple codes or the format changed
    courseIdMapping[course._id.toString()] = [];

    for (const newCode of expanded) {
      // Check if this code was already processed or exists in DB
      let targetId = processedNewCodes[newCode];
      if (!targetId) {
        const existing = await db
          .collection("courses")
          .findOne({ code: newCode });
        if (existing) {
          targetId = existing._id.toString();
        } else {
          // Create new course based on the old one
          const { _id, code, ...rest } = course;
          const newCourseResult = await db.collection("courses").insertOne({
            ...rest,
            code: newCode,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          targetId = newCourseResult.insertedId.toString();
        }
        processedNewCodes[newCode] = targetId;
      }
      courseIdMapping[course._id.toString()].push(targetId);
    }
  }

  // Phase 2: Duplicate content for split courses and update references
  const collectionsWithCourseId = [
    "flashcardsets",
    "materials",
    "progresses",
    "questions",
    "quizzes",
    "usercourseenrollments",
    "mindmaps",
    "studysessions",
    "aicontents",
    "emails",
  ];

  for (const [oldIdStr, newIdStrs] of Object.entries(courseIdMapping)) {
    const oldId = new Types.ObjectId(oldIdStr);

    // If the old course was replaced by one or more new ones
    if (
      newIdStrs.length > 0 &&
      (newIdStrs.length > 1 || newIdStrs[0] !== oldIdStr)
    ) {
      logger.info(
        `[028] Processing split/rename for ${oldIdStr} -> [${newIdStrs.join(", ")}]`,
      );

      for (const colName of collectionsWithCourseId) {
        const docs = await db
          .collection(colName)
          .find({ courseId: oldId })
          .toArray();
        if (docs.length === 0) continue;

        for (const doc of docs) {
          const { _id, ...docData } = doc;

          // For the first new ID, we can just update the existing record (or copy if it's already used)
          // But to be safe and handle "merging", let's check for existing matches
          for (let i = 0; i < newIdStrs.length; i++) {
            const newId = new Types.ObjectId(newIdStrs[i]);

            // Avoid duplicate enrollments if the user is already in the target course
            if (colName === "usercourseenrollments") {
              const existing = await db.collection(colName).findOne({
                userId: docData.userId,
                courseId: newId,
                semester: docData.semester,
                academicYear: docData.academicYear,
              });
              if (existing) continue;
            }

            // Create a new record linked to the new course
            await db.collection(colName).insertOne({
              ...docData,
              courseId: newId,
              createdAt: docData.createdAt || new Date(),
              updatedAt: new Date(),
            });
          }
        }
        // Delete the entries linked to the old ID
        await db.collection(colName).deleteMany({ courseId: oldId });
      }

      // Cleanup: Delete the old course record if it's not one of the new ones
      if (!newIdStrs.includes(oldIdStr)) {
        await db.collection("courses").deleteOne({ _id: oldId });
      }
    }
  }

  // Phase 3: Update ExamTimetable entries
  logger.info("[028] Updating ExamTimetable entries...");
  const timetables = await db.collection("examtimetables").find({}).toArray();
  for (const tDoc of timetables) {
    const originalEntries = tDoc.entries || [];
    const newEntries: any[] = [];
    let modified = false;

    for (const entry of originalEntries) {
      const expanded = expandCourseCodes(entry.courseCode);
      if (expanded.length > 1 || expanded[0] !== entry.courseCode) {
        modified = true;
        for (const code of expanded) {
          // Find the correct courseId for this code
          const course = await db.collection("courses").findOne({ code });
          newEntries.push({
            ...entry,
            courseCode: code,
            courseId: course?._id || entry.courseId,
            isAutoSynced: entry.isAutoSynced ?? false,
          });
        }
      } else {
        // Just standardize format if single
        if (expanded[0] !== entry.courseCode) modified = true;
        newEntries.push({
          ...entry,
          courseCode: expanded[0],
          isAutoSynced: entry.isAutoSynced ?? false,
        });
      }
    }

    if (modified) {
      await db
        .collection("examtimetables")
        .updateOne({ _id: tDoc._id }, { $set: { entries: newEntries } });
    }
  }

  logger.info("[028] Migration complete.");
}
