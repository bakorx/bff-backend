import type { ITask, ITasksMetadata } from "../interfaces";

export type TimetableEventType =
  | "lecture"
  | "tutorial"
  | "lab"
  | "exam"
  | "study_block";

export type TimetableTimingStatus = "ongoing" | "today" | "upcoming" | "past";

export interface ITimetableHeader {
  activeDate: string; // ISO String
  dayName: string; // "Monday"
  formattedDate: string; // "Monday, 12 January"
  academicWeek: number; // 9
  todayEventsCount: number;
  daysToFirstExam: number;
  upNext: {
    title: string;
    courseCode: string;
    time: string;
    venue: string;
    type: TimetableEventType;
  } | null;
  isSynced: boolean;
}

export interface ITimetableDayCard {
  date: string; // "YYYY-MM-DD"
  day: string; // "MON", "TUE", etc.
  dayNumber: string; // "12"
  isToday: boolean;
  isSelected: boolean;
  eventCount: number;
  hasExams: boolean;
}

export interface ITimetableWeekEvent {
  id: string;
  title: string;
  meta: string;
  day: number; // 1 = Monday, ..., 7 = Sunday
  startRow: number;
  endRow: number;
  startTime: string; // "09:00"
  endTime: string; // "11:00"
  type: TimetableEventType;
  courseCode: string;
  courseName: string;
  venue: string;
  scheduledAt: string; // ISO String
  durationMinutes: number;
}

export interface ITimetableExamItem {
  id: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  examType: string;
  scheduledAt: string;
  durationMinutes: number;
  venue: string;
  assignedVenue: string | null;
  daysToExam: number;
  timingStatus: TimetableTimingStatus;
}

export interface IAgendaGroup {
  date: string; // "YYYY-MM-DD"
  dateLabel: string; // "Today · Monday, 12 January"
  events: Array<{
    id: string;
    title: string;
    courseCode: string;
    timeRange: string;
    venue: string;
    type: TimetableEventType;
  }>;
}

export interface IDailyWorkloadHour {
  day: string; // "Mon", "Tue", etc.
  date: string; // "YYYY-MM-DD"
  hrs: number;
}

export interface ITimetableWorkloadMetrics {
  dailyHours: IDailyWorkloadHour[];
  weeklyTotalHours: number;
  streakDays: number;
}

export interface ITimetableOverviewPayload {
  header: ITimetableHeader;
  weekDays: ITimetableDayCard[];
  weekEvents: ITimetableWeekEvent[];
  exams: ITimetableExamItem[];
  agenda: IAgendaGroup[];
  monthEventDates: Record<string, number>; // date "YYYY-MM-DD" -> count of events
  workloadMetrics: ITimetableWorkloadMetrics;
  tasks: {
    tasks: ITask[];
    metadata: ITasksMetadata;
  };
  availableSemesters: string[];
  availableAcademicYears: string[];
  generatedAt: string;
}

export interface ITimetableOverviewResult {
  payload: ITimetableOverviewPayload;
  fromCache: boolean;
}
