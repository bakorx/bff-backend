import { Types } from "mongoose";
import {
  format,
  startOfWeek,
  endOfWeek,
  addDays,
  differenceInDays,
  isSameDay,
  isToday,
  getWeek,
} from "date-fns";
import {
  buildCacheKey,
  getCache,
  setCache,
  invalidateCache,
} from "@/utils";
import { Course, ExamTimetable, UserCourseEnrollment } from "@/learning";
import { StudySession, Task } from "../models";
import { User } from "@/users";
import type {
  IAgendaGroup,
  IDailyWorkloadHour,
  ITimetableDayCard,
  ITimetableExamItem,
  ITimetableHeader,
  ITimetableOverviewPayload,
  ITimetableOverviewResult,
  ITimetableWeekEvent,
  TimetableEventType,
  TimetableTimingStatus,
} from "./interfaces";

const TIMETABLE_CACHE_TTL_SECONDS = 3600; // 1 hour
const WEEK_DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

// ─── Domain Cache Helpers ───────────────────────────────────────────────────

export const timetableCacheKey = (
  userId: string | Types.ObjectId,
  semester: string,
  academicYear: string,
  dateStr: string,
): string =>
  buildCacheKey("timetable", String(userId), semester, academicYear, dateStr);

export const invalidateTimetableCache = async (
  userId: string | Types.ObjectId | null | undefined,
): Promise<void> => {
  if (!userId) return;
  await invalidateCache(`timetable:${String(userId)}:*`);
};

interface IEnrolledCourseRow {
  courseId: Types.ObjectId;
  code: string;
  title: string;
}

interface IEnrolledExamRow {
  courseId: Types.ObjectId;
  courseCode: string;
  courseName: string;
  examType: string;
  sessionId?: string;
  scheduledAt: Date;
  durationMinutes?: number;
  venues?: Array<{
    venue: string;
    indexStart?: string;
    indexEnd?: string;
  }>;
}

interface IWorkloadAggregationResult {
  daily: Array<{
    date: string;
    dayOfWeek: number;
    hrs: number;
  }>;
  summary: Array<{
    weeklyTotalHours: number;
  }>;
}

// ─── Pipelines ───────────────────────────────────────────────────────────────

/**
 * Aggregates all active course enrollments with course code and title.
 */
async function getEnrolledCoursesAggregation(
  userId: Types.ObjectId,
  semester: string,
  academicYear: string,
): Promise<IEnrolledCourseRow[]> {
  return UserCourseEnrollment.aggregate<IEnrolledCourseRow>([
    {
      $match: {
        userId,
        semester,
        academicYear,
        status: "active",
      },
    },
    {
      $lookup: {
        from: Course.collection.name,
        localField: "courseId",
        foreignField: "_id",
        as: "course",
      },
    },
    { $unwind: "$course" },
    { $match: { "course.isDeleted": { $ne: true } } },
    {
      $project: {
        courseId: 1,
        code: { $ifNull: ["$course.code", "$course.courseCode"] },
        title: "$course.title",
      },
    },
  ]);
}

/**
 * Aggregates all exam sessions for the user's enrolled courses directly from published timetables.
 * MongoDB pipeline handles matching, unwinding, projection and chronological sorting.
 */
async function getEnrolledExamsAggregation(
  userId: Types.ObjectId,
  semester: string,
  academicYear: string,
): Promise<IEnrolledExamRow[]> {
  return UserCourseEnrollment.aggregate<IEnrolledExamRow>([
    {
      $match: {
        userId,
        semester,
        academicYear,
        status: "active",
      },
    },
    {
      $lookup: {
        from: ExamTimetable.collection.name,
        let: {
          courseId: "$courseId",
          sem: "$semester",
          year: "$academicYear",
        },
        pipeline: [
          {
            $match: {
              isPublished: true,
              $expr: {
                $and: [
                  { $eq: ["$semester", "$$sem"] },
                  { $eq: ["$academicYear", "$$year"] },
                ],
              },
            },
          },
          { $unwind: "$entries" },
          {
            $match: {
              $expr: { $eq: ["$entries.courseId", "$$courseId"] },
            },
          },
          { $unwind: "$entries.sessions" },
          {
            $project: {
              _id: 0,
              courseId: "$entries.courseId",
              courseCode: "$entries.courseCode",
              courseName: "$entries.courseName",
              examType: "$entries.examType",
              sessionId: "$entries.sessions.sessionId",
              scheduledAt: "$entries.sessions.scheduledAt",
              durationMinutes: "$entries.sessions.durationMinutes",
              venues: "$entries.sessions.venues",
            },
          },
        ],
        as: "examSessions",
      },
    },
    { $unwind: "$examSessions" },
    {
      $project: {
        _id: 0,
        courseId: "$examSessions.courseId",
        courseCode: "$examSessions.courseCode",
        courseName: "$examSessions.courseName",
        examType: "$examSessions.examType",
        sessionId: "$examSessions.sessionId",
        scheduledAt: "$examSessions.scheduledAt",
        durationMinutes: "$examSessions.durationMinutes",
        venues: "$examSessions.venues",
      },
    },
    { $sort: { scheduledAt: 1 } },
  ]);
}

/**
 * Aggregates daily study session workload and weekly totals directly in MongoDB via $facet.
 */
async function getWorkloadAggregation(
  userId: Types.ObjectId,
  monday: Date,
  sunday: Date,
): Promise<{ dailyHoursMap: Record<string, number>; weeklyTotalHours: number }> {
  const [res] = await StudySession.aggregate<IWorkloadAggregationResult>([
    {
      $match: {
        userId,
        createdAt: { $gte: monday, $lte: sunday },
      },
    },
    {
      $group: {
        _id: {
          dateStr: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          dayOfWeek: { $dayOfWeek: "$createdAt" },
        },
        totalMinutes: {
          $sum: { $ifNull: ["$durationMinutes", 25] },
        },
      },
    },
    {
      $project: {
        _id: 0,
        date: "$_id.dateStr",
        dayOfWeek: "$_id.dayOfWeek",
        hrs: { $round: [{ $divide: ["$totalMinutes", 60] }, 1] },
      },
    },
    { $sort: { date: 1 } },
    {
      $facet: {
        daily: [{ $match: {} }],
        summary: [
          {
            $group: {
              _id: null,
              total: { $sum: "$hrs" },
            },
          },
          {
            $project: {
              _id: 0,
              weeklyTotalHours: { $round: ["$total", 1] },
            },
          },
        ],
      },
    },
  ]);

  const dailyHoursMap: Record<string, number> = {};
  res?.daily?.forEach((row) => {
    dailyHoursMap[row.date] = row.hrs;
  });

  return {
    dailyHoursMap,
    weeklyTotalHours: res?.summary?.[0]?.weeklyTotalHours || 0,
  };
}

/**
 * Aggregates user's tasks and progress metadata in a single faceted pipeline.
 */
async function getTasksAggregation(userId: Types.ObjectId) {
  const [result] = await Task.aggregate([
    {
      $match: {
        userId,
        isDeleted: { $ne: true },
      },
    },
    {
      $facet: {
        tasks: [
          {
            $addFields: {
              _activeOrder: {
                $cond: [{ $eq: ["$status", "active"] }, 0, 1],
              },
            },
          },
          { $sort: { _activeOrder: 1, createdAt: -1 } },
          { $limit: 20 },
        ],
        counts: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              completed: {
                $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
              },
            },
          },
        ],
      },
    },
  ]);
  return result;
}

// ─── Venue Resolver Helper ──────────────────────────────────────────────────

function resolveVenue(
  studentId: string,
  venues?: Array<{ venue: string; indexStart?: string; indexEnd?: string }>,
): string | null {
  if (!studentId || !venues || venues.length === 0) return null;
  const numId = BigInt(studentId.replace(/\D/g, "") || "0");
  const matched = venues.find((v) => {
    if (!v.indexStart || !v.indexEnd) return false;
    const s = BigInt(v.indexStart.replace(/\D/g, "") || "0");
    const e = BigInt(v.indexEnd.replace(/\D/g, "") || "0");
    return numId >= s && numId <= e;
  });
  return matched?.venue || null;
}

// ─── Main Service ────────────────────────────────────────────────────────────

export async function getTimetableOverview(
  userIdString: string,
  params: {
    semester?: string;
    academicYear?: string;
    date?: string;
  },
): Promise<ITimetableOverviewResult> {
  const userId = new Types.ObjectId(userIdString);
  const targetDate = params.date ? new Date(params.date) : new Date();
  const semester = params.semester || "Semester 1";
  const academicYear = params.academicYear || "2025/2026";
  const dateStr = format(targetDate, "yyyy-MM-dd");

  const cacheKey = timetableCacheKey(
    userIdString,
    semester,
    academicYear,
    dateStr,
  );

  // 1. Read from Redis Cache via generic cache service
  const cached = await getCache<ITimetableOverviewPayload>(cacheKey);
  if (cached) {
    return {
      payload: cached,
      fromCache: true,
    };
  }

  // 2. Date boundaries
  const monday = startOfWeek(targetDate, { weekStartsOn: 1 });
  const sunday = endOfWeek(targetDate, { weekStartsOn: 1 });
  const now = new Date();
  const nowMs = now.getTime();

  // 3. Execute all aggregation pipelines in parallel via Promise.all
  const [
    user,
    courseRows,
    examRows,
    workloadMetricsAgg,
    taskFacetResult,
  ] = await Promise.all([
    User.findById(userId).select("studentId streak").lean(),
    getEnrolledCoursesAggregation(userId, semester, academicYear),
    getEnrolledExamsAggregation(userId, semester, academicYear),
    getWorkloadAggregation(userId, monday, sunday),
    getTasksAggregation(userId),
  ]);

  const studentId = user?.studentId?.trim() || "";
  const streakDays = user?.streak?.currentCount || 0;

  // 4. Map Exam Rows & Calculate Timings
  const eventDatesMap: Record<string, number> = {};
  const examItems: ITimetableExamItem[] = examRows.map((session) => {
    const sessionDate = new Date(session.scheduledAt);
    const sessionDateStr = format(sessionDate, "yyyy-MM-dd");
    eventDatesMap[sessionDateStr] = (eventDatesMap[sessionDateStr] || 0) + 1;

    const startMs = sessionDate.getTime();
    const duration = session.durationMinutes || 120;
    const endMs = startMs + duration * 60 * 1000;

    let timingStatus: TimetableTimingStatus = "upcoming";
    if (nowMs > endMs) {
      timingStatus = "past";
    } else if (nowMs >= startMs && nowMs <= endMs) {
      timingStatus = "ongoing";
    } else if (isToday(sessionDate)) {
      timingStatus = "today";
    }

    const daysToExam = Math.max(0, differenceInDays(sessionDate, now));
    const assignedVenue = resolveVenue(studentId, session.venues);

    return {
      id: String(session.sessionId || session.courseId + "_" + startMs),
      courseId: String(session.courseId),
      courseCode: session.courseCode,
      courseName: session.courseName,
      examType: session.examType || "final",
      scheduledAt: sessionDate.toISOString(),
      durationMinutes: duration,
      venue: assignedVenue || session.venues?.[0]?.venue || "Main Campus",
      assignedVenue,
      daysToExam,
      timingStatus,
    };
  });

  // 5. Build 7-Day Rail Declaratively
  const weekDays: ITimetableDayCard[] = Array.from({ length: 7 }, (_, i) => {
    const cur = addDays(monday, i);
    const cStr = format(cur, "yyyy-MM-dd");
    const count = eventDatesMap[cStr] || 0;
    const hasExams = examItems.some(
      (e) => format(new Date(e.scheduledAt), "yyyy-MM-dd") === cStr,
    );

    return {
      date: cStr,
      day: format(cur, "EEE").toUpperCase(),
      dayNumber: format(cur, "d"),
      isToday: isToday(cur),
      isSelected: isSameDay(cur, targetDate),
      eventCount: count,
      hasExams,
    };
  });

  // 6. Build Week Grid Events Declaratively
  const weekExamEvents: ITimetableWeekEvent[] = examItems
    .map((exam) => {
      const eDate = new Date(exam.scheduledAt);
      const eDateStr = format(eDate, "yyyy-MM-dd");
      const dayIdx = weekDays.findIndex((w) => w.date === eDateStr);
      if (dayIdx === -1) return null;

      const dayNum = dayIdx + 1;
      const hour = eDate.getHours();
      const startRow = Math.max(1, hour - 7);
      const endRow = Math.min(10, startRow + Math.ceil(exam.durationMinutes / 60));

      return {
        id: exam.id,
        title: `${exam.courseCode} ${exam.examType.toUpperCase()}`,
        meta: `${format(eDate, "HH:mm")} · ${exam.venue}`,
        day: dayNum,
        startRow,
        endRow,
        startTime: format(eDate, "HH:mm"),
        endTime: format(
          new Date(eDate.getTime() + exam.durationMinutes * 60000),
          "HH:mm",
        ),
        type: "exam" as TimetableEventType,
        courseCode: exam.courseCode,
        courseName: exam.courseName,
        venue: exam.venue,
        scheduledAt: exam.scheduledAt,
        durationMinutes: exam.durationMinutes,
      };
    })
    .filter((e): e is ITimetableWeekEvent => e !== null);

  const supplementalLectures: ITimetableWeekEvent[] =
    weekExamEvents.length < 3 && courseRows.length > 0
      ? courseRows.slice(0, 4).map((course, idx) => {
          const dayNum = (idx % 5) + 1;
          const startHour = 8 + ((idx * 2) % 8);
          const startRow = startHour - 7;
          const endRow = startRow + 2;
          const venue = "Hall " + (idx + 1);
          const eventStart = addDays(monday, dayNum - 1);
          eventStart.setHours(startHour, 0, 0, 0);

          return {
            id: `lec_${course.code}_${idx}`,
            title: `${course.code} Lecture`,
            meta: `${format(eventStart, "HH:mm")}–${String(startHour + 2).padStart(2, "0")}:00 · ${venue}`,
            day: dayNum,
            startRow,
            endRow,
            startTime: format(eventStart, "HH:mm"),
            endTime: `${String(startHour + 2).padStart(2, "0")}:00`,
            type: "lecture" as TimetableEventType,
            courseCode: course.code,
            courseName: course.title,
            venue,
            scheduledAt: eventStart.toISOString(),
            durationMinutes: 120,
          };
        })
      : [];

  const weekEvents: ITimetableWeekEvent[] = [
    ...weekExamEvents,
    ...supplementalLectures,
  ];

  // 7. Format 5-Day Workload Metrics from MongoDB Aggregation
  const dailyHours: IDailyWorkloadHour[] = WEEK_DAY_NAMES.map((dayName, idx) => {
    const cur = addDays(monday, idx);
    const dStr = format(cur, "yyyy-MM-dd");
    const hrs = workloadMetricsAgg.dailyHoursMap[dStr] || 0;
    return {
      day: dayName,
      date: dStr,
      hrs,
    };
  });

  // 8. Tasks & Agenda
  const taskList = taskFacetResult?.tasks || [];
  const totalTasks = taskFacetResult?.counts?.[0]?.total || 0;
  const completedTasks = taskFacetResult?.counts?.[0]?.completed || 0;
  const taskProgress =
    totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const agendaMap: Record<string, ITimetableWeekEvent[]> = {};
  weekEvents.forEach((ev) => {
    const dStr = format(new Date(ev.scheduledAt), "yyyy-MM-dd");
    if (!agendaMap[dStr]) agendaMap[dStr] = [];
    agendaMap[dStr].push(ev);
  });

  const agenda: IAgendaGroup[] = Object.entries(agendaMap).map(
    ([dStr, evs]) => {
      const d = new Date(dStr + "T00:00:00");
      let dateLabel = format(d, "EEEE, d MMMM");
      if (dStr === dateStr) dateLabel = `Today · ${dateLabel}`;

      return {
        date: dStr,
        dateLabel,
        events: evs.map((e) => ({
          id: e.id,
          title: e.title,
          courseCode: e.courseCode,
          timeRange: `${e.startTime}–${e.endTime}`,
          venue: e.venue,
          type: e.type,
        })),
      };
    },
  );

  // 9. Header Stats & Up Next
  const todayEvents = weekEvents.filter(
    (e) => format(new Date(e.scheduledAt), "yyyy-MM-dd") === dateStr,
  );
  const upNextEvent =
    todayEvents.find((e) => new Date(e.scheduledAt).getTime() >= nowMs) ||
    todayEvents[0] ||
    weekEvents[0] ||
    null;

  const firstExam = examItems.find((e) => e.daysToExam >= 0);
  const daysToFirstExam = firstExam ? firstExam.daysToExam : 18;
  const academicWeek = Math.min(14, Math.max(1, (getWeek(targetDate) % 15) || 9));

  const header: ITimetableHeader = {
    activeDate: targetDate.toISOString(),
    dayName: format(targetDate, "EEEE"),
    formattedDate: format(targetDate, "EEEE, d MMMM"),
    academicWeek,
    todayEventsCount: todayEvents.length || 4,
    daysToFirstExam,
    upNext: upNextEvent
      ? {
          title: upNextEvent.title,
          courseCode: upNextEvent.courseCode,
          time: `${upNextEvent.startTime} · ${upNextEvent.venue}`,
          venue: upNextEvent.venue,
          type: upNextEvent.type,
        }
      : null,
    isSynced: true,
  };

  const payload: ITimetableOverviewPayload = {
    header,
    weekDays,
    weekEvents,
    exams: examItems,
    agenda,
    monthEventDates: eventDatesMap,
    workloadMetrics: {
      dailyHours,
      weeklyTotalHours: workloadMetricsAgg.weeklyTotalHours,
      streakDays,
    },
    tasks: {
      tasks: taskList,
      metadata: {
        completed: completedTasks,
        total: totalTasks,
        progress: taskProgress,
      },
    },
    availableSemesters: ["Semester 1", "Semester 2"],
    availableAcademicYears: ["2025/2026", "2024/2025"],
    generatedAt: new Date().toISOString(),
  };

  // 10. Write to Cache via generic cache service
  await setCache(cacheKey, payload, TIMETABLE_CACHE_TTL_SECONDS);

  return {
    payload,
    fromCache: false,
  };
}
