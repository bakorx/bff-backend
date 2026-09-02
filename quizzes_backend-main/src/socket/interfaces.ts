/**
 * Socket.io event names — server → client
 * Import EVENT_NAMES everywhere instead of hardcoding strings
 */
export const EVENT_NAMES = {
  // Campaign events
  CAMPAIGN_DISPATCH_STARTED: "campaign:dispatch:started",
  CAMPAIGN_DISPATCH_PROGRESS: "campaign:dispatch:progress",
  CAMPAIGN_DISPATCH_COMPLETED: "campaign:dispatch:completed",
  CAMPAIGN_DISPATCH_FAILED: "campaign:dispatch:failed",
  CAMPAIGN_CANCELLED: "campaign:cancelled",

  // Individual email events
  EMAIL_SENT: "email:sent",
  EMAIL_FAILED: "email:failed",
  EMAIL_BOUNCED: "email:bounced",

  // AI quiz generation events
  QUIZ_GENERATION_STARTED: "quiz:generation:started",
  QUIZ_GENERATION_PLAN_READY: "quiz:generation:plan_ready",
  QUIZ_GENERATION_TASK_STARTED: "quiz:generation:task:started",
  QUIZ_GENERATION_TASK_DONE: "quiz:generation:task:done",
  QUIZ_GENERATION_TASK_FAILED: "quiz:generation:task:failed",
  QUIZ_GENERATION_COMPLETED: "quiz:generation:completed",
  QUIZ_GENERATION_FAILED: "quiz:generation:failed",

  // Public quiz generation events
  PUBLIC_QUIZ_GENERATION_STARTED: "public_quiz:generation:started",
  PUBLIC_QUIZ_GENERATION_PROGRESS: "public_quiz:generation:progress",
  PUBLIC_QUIZ_GENERATION_LECTURE_STARTED:
    "public_quiz:generation:lecture:started",
  PUBLIC_QUIZ_GENERATION_LECTURE_COMPLETED:
    "public_quiz:generation:lecture:completed",
  PUBLIC_QUIZ_GENERATION_LECTURE_FAILED:
    "public_quiz:generation:lecture:failed",
  PUBLIC_QUIZ_GENERATION_COMPLETED: "public_quiz:generation:completed",
  PUBLIC_QUIZ_GENERATION_FAILED: "public_quiz:generation:failed",

  // Profile + recommendation events
  PROFILE_REAGGREGATION_STARTED: "profile:reaggregation:started",
  PROFILE_REAGGREGATION_COMPLETED: "profile:reaggregation:completed",
  RECOMMENDATION_REFRESH_STARTED: "recommendation:refresh:started",
  RECOMMENDATION_REFRESH_COMPLETED: "recommendation:refresh:completed",

  // Approval events
  APPROVAL_STATUS_CHANGED: "approval:status:changed",

  // Program events
  PROGRAM_OFFERING_PUBLISHED: "program:offering:published",

  // Notification events (in-app counterpart for push notifications)
  EXAM_REMINDER: "notification:exam_reminder",
  QUIZ_AVAILABLE: "notification:quiz_available",
  STUDY_PARTNER_REQUEST: "notification:study_partner_request",
  STUDY_PARTNER_MESSAGE: "notification:study_partner_message",
  COURSE_ANNOUNCEMENT: "notification:course_announcement",
  SECURITY_ALERT: "notification:security_alert",
  ACCOUNT_ACTIVITY: "notification:account_activity",
  SYSTEM_NOTIFICATION: "notification:system_notification",
  TEST_PUSH: "notification:test_push",

  // Generic job events
  JOB_STARTED: "job:started",
  JOB_COMPLETED: "job:completed",
  JOB_FAILED: "job:failed",
  JOB_PROGRESS: "job:progress",

  // Z-agent session events
  APP_DIRECTIVE: "app:directive",
  APP_TOPIC_UNLOCKED: "app:topic_unlocked",
  APP_SIGNAL: "app:signal",
  APP_PHASE_CHANGED: "app:phase_changed",
  APP_ARTIFACT: "app:artifact",
  APP_ARTIFACT_UPDATED: "app:artifact_updated",
  APP_STUDY_PLAN_UPDATED: "app:study_plan_updated",
  APP_BLOCK_COMPLETED: "app:block_completed",
  APP_CITATION: "app:citation",
  MATERIAL_SUMMARY_READY: "material:summary_ready",
  APP_INTERRUPTED: "app:interrupted",
  APP_SESSION_TRIGGER: "app:session_trigger",

  // Timetable real-time sync event
  TIMETABLE_SYNCED: "timetable:synced",

  // Event bus (docs/rec-engine.md §6, issue #180) — notify-only, consumers
  // refetch via GET /api/v1/events, never read payload off the socket.
  EVENT_FEED_ITEM_CREATED: "event_feed:item_created",

  // 24h-after-flag cron (docs/rec-engine.md §11, #11).
  REC_DELAYED: "rec:delayed",

  // In-session recommendation trigger (docs/rec-engine.md §10, #9).
  REC_IN_SESSION: "rec:in_session",
} as const;

export type EventName = (typeof EVENT_NAMES)[keyof typeof EVENT_NAMES];

// -------------------------------------------------------------------------
// Payload types — one per event
// -------------------------------------------------------------------------

export interface CampaignDispatchStartedPayload {
  campaignId: string;
  campaignType: string;
  totalRecipients: number;
  startedAt: Date;
}

export interface CampaignDispatchProgressPayload {
  campaignId: string;
  sent: number;
  failed: number;
  total: number;
  percentComplete: number;
}

export interface CampaignDispatchCompletedPayload {
  campaignId: string;
  sent: number;
  failed: number;
  total: number;
  completedAt: Date;
}

export interface CampaignDispatchFailedPayload {
  campaignId: string;
  reason: string;
  failedAt: Date;
}

export interface EmailSentPayload {
  campaignId: string;
  recipientEmail: string;
  sentAt: Date;
}

export interface EmailFailedPayload {
  campaignId: string;
  recipientEmail: string;
  reason: string;
  failedAt: Date;
}

export interface EmailBouncedPayload {
  campaignId: string;
  recipientEmail: string;
  bouncedAt: Date;
}

export interface QuizGenerationStartedPayload {
  personalQuizId: string;
  userId: string;
  totalTasks: number;
  startedAt: Date;
}

export interface QuizGenerationPlanReadyPayload {
  personalQuizId: string;
  userId: string;
  plan: {
    lectureTitle: string;
    topics: {
      title: string;
      questionTypes: { type: string; count: number }[];
      totalQuestions: number;
    }[];
    totalQuestions: number;
    estimatedDuration: string;
  }[];
}

export interface QuizGenerationTaskStartedPayload {
  personalQuizId: string;
  userId: string;
  taskIndex: number;
  taskLabel: string;
  totalTasks: number;
}

export interface QuizGenerationTaskDonePayload {
  personalQuizId: string;
  userId: string;
  taskIndex: number;
  taskLabel: string;
  completedTasks: number;
  totalTasks: number;
  percentComplete: number;
}

export interface QuizGenerationTaskFailedPayload {
  personalQuizId: string;
  userId: string;
  taskIndex: number;
  taskLabel: string;
  errorMessage: string;
}

export interface QuizGenerationCompletedPayload {
  personalQuizId: string;
  userId: string;
  totalQuestions: number;
  completedAt: Date;
}

export interface QuizGenerationFailedPayload {
  personalQuizId: string;
  userId: string;
  reason: string;
  failedAt: Date;
}

// Public quiz generation payload types
export interface PublicQuizGenerationStartedPayload {
  generationId: string;
  courseId: string;
  courseCode: string;
  userId: string;
  totalLectures: number;
  questionsPerLecture: number;
  startedAt: Date;
  stage?: string;
  message?: string;
}

export interface PublicQuizGenerationProgressPayload {
  generationId: string;
  courseId: string;
  completedLectures: number;
  totalLectures: number;
  currentLecture?: string;
  percentComplete: number;
  currentTopic?: string;
  completedTopics?: number;
  totalTopics?: number;
  stage?: string;
  message?: string;
}

export interface PublicQuizGenerationLectureStartedPayload {
  generationId: string;
  courseId: string;
  lectureTitle: string;
  lectureIndex: number;
  totalLectures: number;
  stage?: string;
  message?: string;
}

export interface PublicQuizGenerationLectureCompletedPayload {
  generationId: string;
  courseId: string;
  lectureTitle: string;
  lectureIndex: number;
  totalLectures: number;
  questionsGenerated: number;
  completedLectures: number;
  percentComplete: number;
  stage?: string;
  message?: string;
}

export interface PublicQuizGenerationLectureFailedPayload {
  generationId: string;
  courseId: string;
  lectureTitle: string;
  error: string;
  stage?: string;
  message?: string;
}

export interface PublicQuizGenerationCompletedPayload {
  generationId: string;
  courseId: string;
  courseCode: string;
  totalLectures: number;
  totalQuestionsGenerated: number;
  totalJobsQueued: number;
  completedAt: Date;
}

export interface PublicQuizGenerationFailedPayload {
  generationId: string;
  courseId: string;
  reason: string;
  failedAt: Date;
}

export interface ProfileReaggregationCompletedPayload {
  userId: string;
  reaggregatedAt: Date;
}

export interface RecommendationRefreshCompletedPayload {
  userId: string;
  refreshedAt: Date;
  expiresAt: Date;
}

export interface ApprovalStatusChangedPayload {
  contentId: string;
  contentType: "course" | "quiz" | "material";
  newStatus: "approved" | "rejected" | "pending_approval";
  reviewedBy?: string;
  note?: string;
  changedAt: Date;
}

export interface ProgramOfferingPublishedPayload {
  programOfferingId: string;
  programId: string;
  universityId: string;
  programName: string;
  publishedAt: Date;
}

export interface JobStartedPayload {
  jobName: string;
  jobId: string;
  queueName: string;
  startedAt: Date;
  meta?: Record<string, string>;
}

export interface JobCompletedPayload {
  jobName: string;
  jobId: string;
  queueName: string;
  completedAt: Date;
  meta?: Record<string, string>;
}

export interface JobFailedPayload {
  jobName: string;
  jobId: string;
  queueName: string;
  reason: string;
  failedAt: Date;
  meta?: Record<string, string>;
}

export interface JobProgressPayload {
  jobName: string;
  jobId: string;
  queueName: string;
  progress: number; // 0–100
  message?: string;
  meta?: Record<string, string>;
}

// -------------------------------------------------------------------------
// Notification payload types — in-app counterpart for push notifications
// -------------------------------------------------------------------------

export interface ExamReminderPayload {
  userId: string;
  courseCode: string;
  courseName: string;
  daysUntil: number;
  examDate: string;
}

export interface QuizAvailablePayload {
  userId: string;
  quizId: string;
  quizTitle: string;
  courseCode: string;
}

export interface StudyPartnerRequestPayload {
  userId: string;
  senderName: string;
}

export interface StudyPartnerMessagePayload {
  userId: string;
  senderName: string;
  preview: string;
}

export interface CourseAnnouncementPayload {
  courseCode: string;
  message: string;
}

export interface SecurityAlertPayload {
  userId: string;
  message: string;
}

export interface AccountActivityPayload {
  userId: string;
  message: string;
}

export interface SystemNotificationPayload {
  title: string;
  body: string;
}

export interface TestPushPayload {
  userId: string;
  title: string;
  body: string;
  success: boolean;
}

// -------------------------------------------------------------------------
// Z-agent session payload types
// -------------------------------------------------------------------------

export interface AppDirectivePayload {
  signalId: string;
  sessionId: string;
  userId: string;
  directive: {
    type: string;
    payload: Record<string, unknown>;
  };
  message?: string;
}

export interface AppTopicUnlockedPayload {
  signalId: string;
  sessionId: string;
  userId: string;
  unlockedTopic: string;
  previousTopic: string;
  score: number;
}

export interface AppSignalPayload {
  signalId: string;
  sessionId: string;
  userId: string;
  type: string;
  payload: unknown;
  timestamp: Date;
}

export interface AppPhaseChangedPayload {
  signalId: string;
  sessionId: string;
  userId: string;
  newPhase: string;
  previousPhase?: string;
  changedAt: Date;
}

export interface AppArtifactPayload {
  signalId: string;
  sessionId: string;
  userId: string;
  artifactId: string;
  artifactType: string;
  title: string;
  savedAt: Date;
}

export interface AppInterruptedPayload {
  signalId: string;
  sessionId: string;
  userId: string;
  instruction: string;
  interruptedAt: Date;
}

export interface AppSessionTriggerPayload {
  sessionId: string;
  userId: string;
  trigger: string;
  payload: any;
  timestamp: string;
}

export interface TimetableSyncedPayload {
  studentId: string;
  count: number;
  entries: any[];
  syncedAt: Date;
}

export interface EventFeedItemCreatedPayload {
  eventId: string;
  eventType: string;
  userId: string;
}

export interface RecDelayedPayload {
  userId: string;
  recSet: unknown; // RecommendationSet (@/recommendations) — kept loose here to avoid a socket -> recommendations import
}

export interface RecInSessionPayload {
  userId: string;
  sessionId: string;
  concept: string;
  recSet: unknown; // RecommendationSet (@/recommendations) — see RecDelayedPayload's note
}
