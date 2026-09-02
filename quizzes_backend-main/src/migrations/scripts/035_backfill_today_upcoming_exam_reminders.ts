import { Mongoose, Types } from "mongoose";
import { shortQueue } from "@/schedulers";
import { logger } from "@/config";

type VenueMapping = {
  venue: string;
  indexStart?: string;
  indexEnd?: string;
};

type TimetableSession = {
  sessionId?: string;
  scheduledAt: Date | string;
  label?: string;
  venues?: VenueMapping[];
};

type TimetableEntry = {
  _id: Types.ObjectId;
  courseId: Types.ObjectId;
  courseCode: string;
  courseName: string;
  sessions: TimetableSession[];
};

type TimetableDoc = {
  _id: Types.ObjectId;
  semester: string;
  academicYear: string;
  isPublished: boolean;
  entries: TimetableEntry[];
};

export async function up(mongoose: Mongoose) {
  logger.info(
    "Starting migration: 035_backfill_today_upcoming_exam_reminders...",
  );

  const db = mongoose.connection.db;
  if (!db) throw new Error("No active DB connection");

  const now = new Date();
  const endOfUtcDay = new Date(now);
  endOfUtcDay.setUTCHours(23, 59, 59, 999);

  const timetablesCollection = db.collection<TimetableDoc>("examtimetables");
  const enrollmentsCollection = db.collection("usercourseenrollments");

  const publishedTimetables = await timetablesCollection
    .find({ isPublished: true })
    .toArray();

  let queuedCount = 0;
  let candidateCount = 0;

  for (const timetable of publishedTimetables) {
    for (const entry of timetable.entries || []) {
      const upcomingTodaySessions = (entry.sessions || []).filter((session) => {
        const scheduledAt = new Date(session.scheduledAt);
        return scheduledAt > now && scheduledAt <= endOfUtcDay;
      });

      if (upcomingTodaySessions.length === 0) continue;

      const enrollments = await enrollmentsCollection
        .find({
          courseId: entry.courseId,
          semester: timetable.semester,
          academicYear: timetable.academicYear,
        })
        .project({ userId: 1 })
        .toArray();

      for (const enrollment of enrollments) {
        const userId = String(enrollment.userId);
        for (const session of upcomingTodaySessions) {
          const scheduledAt = new Date(session.scheduledAt);
          candidateCount += 1;

          const sessionRef = session.sessionId || `at_${scheduledAt.getTime()}`;
          const jobId = `migration_035_exam_reminder_${String(timetable._id)}_${String(entry._id)}_${sessionRef}_${userId}_d0`;

          await shortQueue.enqueue(
            "push:exam_reminder",
            {
              userId,
              courseId: String(entry.courseId),
              courseCode: entry.courseCode,
              courseName: entry.courseName,
              daysUntil: 0,
              examDate: scheduledAt.toISOString(),
              label: session.label,
              venues: session.venues || [],
            },
            3,
            jobId,
            0,
          );

          queuedCount += 1;
        }
      }
    }
  }

  logger.info(
    `[035] Completed. Candidates=${candidateCount}, Enqueued=${queuedCount}, Window=${now.toISOString()} -> ${endOfUtcDay.toISOString()}`,
  );
}

export async function down(_mongoose: Mongoose) {
  logger.info(
    "Down migration for 035: No-op (queue side-effects cannot be safely rolled back).",
  );
}
