import { getIO } from "./services";
import { logger, redisConnection } from "@/config";
import { EVENT_NAMES } from "./interfaces";
import type {
  CampaignDispatchStartedPayload,
  CampaignDispatchProgressPayload,
  CampaignDispatchCompletedPayload,
  CampaignDispatchFailedPayload,
  EmailSentPayload,
  EmailFailedPayload,
  EmailBouncedPayload,
  QuizGenerationStartedPayload,
  QuizGenerationPlanReadyPayload,
  QuizGenerationTaskStartedPayload,
  QuizGenerationTaskDonePayload,
  QuizGenerationTaskFailedPayload,
  QuizGenerationCompletedPayload,
  QuizGenerationFailedPayload,
  PublicQuizGenerationStartedPayload,
  PublicQuizGenerationProgressPayload,
  PublicQuizGenerationLectureStartedPayload,
  PublicQuizGenerationLectureCompletedPayload,
  PublicQuizGenerationLectureFailedPayload,
  PublicQuizGenerationCompletedPayload,
  PublicQuizGenerationFailedPayload,
  ProfileReaggregationCompletedPayload,
  RecommendationRefreshCompletedPayload,
  ApprovalStatusChangedPayload,
  ProgramOfferingPublishedPayload,
  JobStartedPayload,
  JobCompletedPayload,
  JobFailedPayload,
  JobProgressPayload,
  ExamReminderPayload,
  QuizAvailablePayload,
  StudyPartnerRequestPayload,
  StudyPartnerMessagePayload,
  CourseAnnouncementPayload,
  SecurityAlertPayload,
  AccountActivityPayload,
  SystemNotificationPayload,
  TestPushPayload,
  AppDirectivePayload,
  AppTopicUnlockedPayload,
  AppSignalPayload,
  AppPhaseChangedPayload,
  AppArtifactPayload,
  AppInterruptedPayload,
  AppSessionTriggerPayload,
  TimetableSyncedPayload,
  EventFeedItemCreatedPayload,
  RecDelayedPayload,
  RecInSessionPayload,
} from "./interfaces";
import { nanoid } from "nanoid";

/**
 * All emit methods follow the same pattern:
 *   - Emit to campaign room (admins watching the campaign)
 *   - AND/OR emit to user room (the individual user)
 * Never throws — wrapped in try/catch, errors are logged not propagated.
 * Queue handlers must never fail because of a socket emit.
 */
export const publishers = {
  // -------------------------------------------------------------------------
  // Campaign events — emit to campaign room
  // -------------------------------------------------------------------------

  campaignDispatchStarted(payload: CampaignDispatchStartedPayload): void {
    emit(
      `campaign:${payload.campaignId}`,
      EVENT_NAMES.CAMPAIGN_DISPATCH_STARTED,
      payload,
    );
  },

  campaignDispatchProgress(payload: CampaignDispatchProgressPayload): void {
    emit(
      `campaign:${payload.campaignId}`,
      EVENT_NAMES.CAMPAIGN_DISPATCH_PROGRESS,
      payload,
    );
  },

  campaignDispatchCompleted(payload: CampaignDispatchCompletedPayload): void {
    emit(
      `campaign:${payload.campaignId}`,
      EVENT_NAMES.CAMPAIGN_DISPATCH_COMPLETED,
      payload,
    );
  },

  campaignDispatchFailed(payload: CampaignDispatchFailedPayload): void {
    emit(
      `campaign:${payload.campaignId}`,
      EVENT_NAMES.CAMPAIGN_DISPATCH_FAILED,
      payload,
    );
  },

  // -------------------------------------------------------------------------
  // Individual email events — emit to campaign room
  // -------------------------------------------------------------------------

  emailSent(payload: EmailSentPayload): void {
    emit(`campaign:${payload.campaignId}`, EVENT_NAMES.EMAIL_SENT, payload);
  },

  emailFailed(payload: EmailFailedPayload): void {
    emit(`campaign:${payload.campaignId}`, EVENT_NAMES.EMAIL_FAILED, payload);
  },

  emailBounced(payload: EmailBouncedPayload): void {
    emit(`campaign:${payload.campaignId}`, EVENT_NAMES.EMAIL_BOUNCED, payload);
  },

  // -------------------------------------------------------------------------
  // AI quiz generation events — emit to quiz_generation room + user room
  // -------------------------------------------------------------------------

  quizGenerationStarted(payload: QuizGenerationStartedPayload): void {
    emit(
      `quiz_generation:${payload.personalQuizId}`,
      EVENT_NAMES.QUIZ_GENERATION_STARTED,
      payload,
    );
    emit(
      `user:${payload.userId}`,
      EVENT_NAMES.QUIZ_GENERATION_STARTED,
      payload,
    );
  },

  quizGenerationPlanReady(payload: QuizGenerationPlanReadyPayload): void {
    emit(
      `quiz_generation:${payload.personalQuizId}`,
      EVENT_NAMES.QUIZ_GENERATION_PLAN_READY,
      payload,
    );
    emit(
      `user:${payload.userId}`,
      EVENT_NAMES.QUIZ_GENERATION_PLAN_READY,
      payload,
    );
  },

  quizGenerationTaskStarted(payload: QuizGenerationTaskStartedPayload): void {
    emit(
      `quiz_generation:${payload.personalQuizId}`,
      EVENT_NAMES.QUIZ_GENERATION_TASK_STARTED,
      payload,
    );
  },

  quizGenerationTaskDone(payload: QuizGenerationTaskDonePayload): void {
    emit(
      `quiz_generation:${payload.personalQuizId}`,
      EVENT_NAMES.QUIZ_GENERATION_TASK_DONE,
      payload,
    );
  },

  quizGenerationTaskFailed(payload: QuizGenerationTaskFailedPayload): void {
    emit(
      `quiz_generation:${payload.personalQuizId}`,
      EVENT_NAMES.QUIZ_GENERATION_TASK_FAILED,
      payload,
    );
  },

  quizGenerationCompleted(payload: QuizGenerationCompletedPayload): void {
    emit(
      `quiz_generation:${payload.personalQuizId}`,
      EVENT_NAMES.QUIZ_GENERATION_COMPLETED,
      payload,
    );
    emit(
      `user:${payload.userId}`,
      EVENT_NAMES.QUIZ_GENERATION_COMPLETED,
      payload,
    );
  },

  quizGenerationFailed(payload: QuizGenerationFailedPayload): void {
    emit(
      `quiz_generation:${payload.personalQuizId}`,
      EVENT_NAMES.QUIZ_GENERATION_FAILED,
      payload,
    );
    emit(`user:${payload.userId}`, EVENT_NAMES.QUIZ_GENERATION_FAILED, payload);
  },

  // -------------------------------------------------------------------------
  // Public quiz generation events — emit to user room
  // -------------------------------------------------------------------------

  publicQuizGenerationStarted(
    userId: string,
    payload: PublicQuizGenerationStartedPayload,
  ): void {
    emit(
      `public_quiz_gen:${payload.generationId}`,
      EVENT_NAMES.PUBLIC_QUIZ_GENERATION_STARTED,
      payload,
    );
    emit(`user:${userId}`, EVENT_NAMES.PUBLIC_QUIZ_GENERATION_STARTED, payload);
  },

  publicQuizGenerationProgress(
    userId: string,
    payload: PublicQuizGenerationProgressPayload,
  ): void {
    emit(
      `public_quiz_gen:${payload.generationId}`,
      EVENT_NAMES.PUBLIC_QUIZ_GENERATION_PROGRESS,
      payload,
    );
    emit(
      `user:${userId}`,
      EVENT_NAMES.PUBLIC_QUIZ_GENERATION_PROGRESS,
      payload,
    );
  },

  publicQuizGenerationLectureStarted(
    userId: string,
    payload: PublicQuizGenerationLectureStartedPayload,
  ): void {
    emit(
      `public_quiz_gen:${payload.generationId}`,
      EVENT_NAMES.PUBLIC_QUIZ_GENERATION_LECTURE_STARTED,
      payload,
    );
    emit(
      `user:${userId}`,
      EVENT_NAMES.PUBLIC_QUIZ_GENERATION_LECTURE_STARTED,
      payload,
    );
  },

  publicQuizGenerationLectureCompleted(
    userId: string,
    payload: PublicQuizGenerationLectureCompletedPayload,
  ): void {
    emit(
      `public_quiz_gen:${payload.generationId}`,
      EVENT_NAMES.PUBLIC_QUIZ_GENERATION_LECTURE_COMPLETED,
      payload,
    );
    emit(
      `user:${userId}`,
      EVENT_NAMES.PUBLIC_QUIZ_GENERATION_LECTURE_COMPLETED,
      payload,
    );
  },

  publicQuizGenerationLectureFailed(
    userId: string,
    payload: PublicQuizGenerationLectureFailedPayload,
  ): void {
    emit(
      `public_quiz_gen:${payload.generationId}`,
      EVENT_NAMES.PUBLIC_QUIZ_GENERATION_LECTURE_FAILED,
      payload,
    );
    emit(
      `user:${userId}`,
      EVENT_NAMES.PUBLIC_QUIZ_GENERATION_LECTURE_FAILED,
      payload,
    );
  },

  publicQuizGenerationCompleted(
    userId: string,
    payload: PublicQuizGenerationCompletedPayload,
  ): void {
    emit(
      `public_quiz_gen:${payload.generationId}`,
      EVENT_NAMES.PUBLIC_QUIZ_GENERATION_COMPLETED,
      payload,
    );
    emit(
      `user:${userId}`,
      EVENT_NAMES.PUBLIC_QUIZ_GENERATION_COMPLETED,
      payload,
    );
  },

  publicQuizGenerationFailed(
    userId: string,
    payload: PublicQuizGenerationFailedPayload,
  ): void {
    emit(
      `public_quiz_gen:${payload.generationId}`,
      EVENT_NAMES.PUBLIC_QUIZ_GENERATION_FAILED,
      payload,
    );
    emit(`user:${userId}`, EVENT_NAMES.PUBLIC_QUIZ_GENERATION_FAILED, payload);
  },

  // Material-level events (for zFlow-based generation)
  publicQuizGenerationMaterialStarted(
    userId: string,
    generationId: string,
    courseId: string,
    materialId: string,
    materialTitle: string,
  ): void {
    const payload = {
      generationId,
      courseId,
      materialId,
      materialTitle,
      status: "processing",
    };
    emit(
      `public_quiz_gen:${generationId}`,
      EVENT_NAMES.PUBLIC_QUIZ_GENERATION_LECTURE_STARTED,
      payload,
    );
    emit(
      `user:${userId}`,
      EVENT_NAMES.PUBLIC_QUIZ_GENERATION_LECTURE_STARTED,
      payload,
    );
  },

  publicQuizGenerationMaterialCompleted(
    userId: string,
    generationId: string,
    courseId: string,
    materialId: string,
    materialTitle: string,
    quizId: string,
    questionsGenerated: number,
    lectureCount: number,
  ): void {
    const payload = {
      generationId,
      courseId,
      materialId,
      lectureTitle: materialTitle,
      questionsGenerated,
      quizId,
      status: "completed",
    };
    emit(
      `public_quiz_gen:${generationId}`,
      EVENT_NAMES.PUBLIC_QUIZ_GENERATION_LECTURE_COMPLETED,
      payload,
    );
    emit(
      `user:${userId}`,
      EVENT_NAMES.PUBLIC_QUIZ_GENERATION_LECTURE_COMPLETED,
      payload,
    );
  },

  publicQuizGenerationMaterialFailed(
    userId: string,
    generationId: string,
    courseId: string,
    materialId: string,
    materialTitle: string,
    error: string,
  ): void {
    const payload = {
      generationId,
      courseId,
      lectureTitle: materialTitle,
      error,
    };
    emit(
      `public_quiz_gen:${generationId}`,
      EVENT_NAMES.PUBLIC_QUIZ_GENERATION_LECTURE_FAILED,
      payload,
    );
    emit(
      `user:${userId}`,
      EVENT_NAMES.PUBLIC_QUIZ_GENERATION_LECTURE_FAILED,
      payload,
    );
  },

  // -------------------------------------------------------------------------
  // Profile + recommendation events — emit to user room only
  // -------------------------------------------------------------------------

  profileReaggregationCompleted(
    payload: ProfileReaggregationCompletedPayload,
  ): void {
    emit(
      `user:${payload.userId}`,
      EVENT_NAMES.PROFILE_REAGGREGATION_COMPLETED,
      payload,
    );
  },

  recommendationRefreshCompleted(
    payload: RecommendationRefreshCompletedPayload,
  ): void {
    emit(
      `user:${payload.userId}`,
      EVENT_NAMES.RECOMMENDATION_REFRESH_COMPLETED,
      payload,
    );
  },

  // -------------------------------------------------------------------------
  // Approval events — emit to user room (content owner)
  // -------------------------------------------------------------------------

  approvalStatusChanged(
    userId: string,
    payload: ApprovalStatusChangedPayload,
  ): void {
    emit(`user:${userId}`, EVENT_NAMES.APPROVAL_STATUS_CHANGED, payload);
  },

  // -------------------------------------------------------------------------
  // Program events — emit to user rooms of subscribers
  // -------------------------------------------------------------------------

  programOfferingPublished(
    payload: ProgramOfferingPublishedPayload,
    subscriberUserIds: string[],
  ): void {
    for (const userId of subscriberUserIds) {
      emit(`user:${userId}`, EVENT_NAMES.PROGRAM_OFFERING_PUBLISHED, payload);
    }
  },

  // -------------------------------------------------------------------------
  // Generic job events — emit to user room
  // -------------------------------------------------------------------------

  jobStarted(userId: string, payload: JobStartedPayload): void {
    emit(`user:${userId}`, EVENT_NAMES.JOB_STARTED, payload);
  },

  jobCompleted(userId: string, payload: JobCompletedPayload): void {
    emit(`user:${userId}`, EVENT_NAMES.JOB_COMPLETED, payload);
  },

  jobFailed(userId: string, payload: JobFailedPayload): void {
    emit(`user:${userId}`, EVENT_NAMES.JOB_FAILED, payload);
  },

  jobProgress(userId: string, payload: JobProgressPayload): void {
    emit(`user:${userId}`, EVENT_NAMES.JOB_PROGRESS, payload);
  },

  // -------------------------------------------------------------------------
  // Notification events — in-app counterpart for push notifications
  // -------------------------------------------------------------------------

  examReminder(payload: ExamReminderPayload): void {
    emit(`user:${payload.userId}`, EVENT_NAMES.EXAM_REMINDER, payload);
  },

  quizAvailable(payload: QuizAvailablePayload): void {
    emit(`user:${payload.userId}`, EVENT_NAMES.QUIZ_AVAILABLE, payload);
  },

  studyPartnerRequest(payload: StudyPartnerRequestPayload): void {
    emit(`user:${payload.userId}`, EVENT_NAMES.STUDY_PARTNER_REQUEST, payload);
  },

  studyPartnerMessage(payload: StudyPartnerMessagePayload): void {
    emit(`user:${payload.userId}`, EVENT_NAMES.STUDY_PARTNER_MESSAGE, payload);
  },

  courseAnnouncement(
    userIds: string[],
    payload: CourseAnnouncementPayload,
  ): void {
    for (const userId of userIds) {
      emit(`user:${userId}`, EVENT_NAMES.COURSE_ANNOUNCEMENT, payload);
    }
  },

  securityAlert(payload: SecurityAlertPayload): void {
    emit(`user:${payload.userId}`, EVENT_NAMES.SECURITY_ALERT, payload);
  },

  accountActivity(payload: AccountActivityPayload): void {
    emit(`user:${payload.userId}`, EVENT_NAMES.ACCOUNT_ACTIVITY, payload);
  },

  systemNotification(
    userIds: string[],
    payload: SystemNotificationPayload,
  ): void {
    for (const userId of userIds) {
      emit(`user:${userId}`, EVENT_NAMES.SYSTEM_NOTIFICATION, payload);
    }
  },

  testPush(payload: TestPushPayload): void {
    emit(`user:${payload.userId}`, EVENT_NAMES.TEST_PUSH, payload);
  },

  // -------------------------------------------------------------------------
  // Session events — emit to session room + user room
  // -------------------------------------------------------------------------

  appTopicUnlocked(
    sessionId: string,
    userId: string,
    data: { unlockedTopic: string; previousTopic: string; score: number },
  ): void {
    const signalId = nanoid();
    const p: AppTopicUnlockedPayload = { signalId, sessionId, userId, ...data };
    emit(`app:${sessionId}`, EVENT_NAMES.APP_TOPIC_UNLOCKED, p);
    emit(`user:${userId}`, EVENT_NAMES.APP_TOPIC_UNLOCKED, p);
  },

  appSignal(
    sessionId: string,
    userId: string,
    signal: { type: string; payload: unknown; timestamp: Date },
  ): void {
    const signalId = nanoid();
    const p: AppSignalPayload = { signalId, sessionId, userId, ...signal };
    emit(`app:${sessionId}`, EVENT_NAMES.APP_SIGNAL, p);
    emit(`user:${userId}`, EVENT_NAMES.APP_SIGNAL, p);
  },

  appPhaseChanged(
    sessionId: string,
    userId: string,
    data: { newPhase: string; previousPhase?: string },
  ): void {
    const signalId = nanoid();
    const p: AppPhaseChangedPayload = {
      signalId,
      sessionId,
      userId,
      ...data,
      changedAt: new Date(),
    };
    emit(`app:${sessionId}`, EVENT_NAMES.APP_PHASE_CHANGED, p);
    emit(`user:${userId}`, EVENT_NAMES.APP_PHASE_CHANGED, p);
  },

  appArtifact(
    sessionId: string,
    userId: string,
    artifactId: string,
    artifactType: string,
    title: string,
  ): void {
    const signalId = nanoid();
    const p: AppArtifactPayload = {
      signalId,
      sessionId,
      userId,
      artifactId,
      artifactType,
      title,
      savedAt: new Date(),
    };
    emit(`app:${sessionId}`, EVENT_NAMES.APP_ARTIFACT, p);
    emit(`user:${userId}`, EVENT_NAMES.APP_ARTIFACT, p);
  },

  appArtifactUpdated(
    sessionId: string,
    userId: string,
    artifact: unknown,
  ): void {
    const p = {
      sessionId,
      userId,
      artifact,
      updatedAt: new Date(),
    };
    emit(`app:${sessionId}`, EVENT_NAMES.APP_ARTIFACT_UPDATED, p);
    emit(`user:${userId}`, EVENT_NAMES.APP_ARTIFACT_UPDATED, p);
  },

  appStudyPlanUpdated(sessionId: string, userId: string, plan: unknown): void {
    const p = {
      sessionId,
      userId,
      plan,
      updatedAt: new Date(),
    };
    emit(`app:${sessionId}`, EVENT_NAMES.APP_STUDY_PLAN_UPDATED, p);
    emit(`user:${userId}`, EVENT_NAMES.APP_STUDY_PLAN_UPDATED, p);
  },

  appBlockCompleted(
    sessionId: string,
    userId: string,
    payload: {
      blockId: string;
      completed: boolean;
      chapterId: string;
      chapterProgress?: { completed: number; total: number };
      sessionProgress?: { completed: number; total: number };
    },
  ): void {
    const p = {
      sessionId,
      userId,
      ...payload,
      timestamp: new Date(),
    };
    emit(`app:${sessionId}`, EVENT_NAMES.APP_BLOCK_COMPLETED, p);
    emit(`user:${userId}`, EVENT_NAMES.APP_BLOCK_COMPLETED, p);
  },

  appCitation(sessionId: string, userId: string, citation: unknown): void {
    const p = {
      sessionId,
      userId,
      citation,
      timestamp: new Date(),
    };
    emit(`app:${sessionId}`, EVENT_NAMES.APP_CITATION, p);
    emit(`user:${userId}`, EVENT_NAMES.APP_CITATION, p);
  },

  materialSummaryReady(
    materialId: string,
    userId?: string,
    payload?: unknown,
  ): void {
    const p = {
      materialId,
      userId,
      payload,
      timestamp: new Date(),
    };
    emit(`material:${materialId}`, EVENT_NAMES.MATERIAL_SUMMARY_READY, p);
    if (userId) {
      emit(`user:${userId}`, EVENT_NAMES.MATERIAL_SUMMARY_READY, p);
    }
  },

  appInterrupted(sessionId: string, userId: string, instruction: string): void {
    const signalId = nanoid();
    const p: AppInterruptedPayload = {
      signalId,
      sessionId,
      userId,
      instruction,
      interruptedAt: new Date(),
    };
    emit(`app:${sessionId}`, EVENT_NAMES.APP_INTERRUPTED, p);
    emit(`user:${userId}`, EVENT_NAMES.APP_INTERRUPTED, p);
  },

  timetableSynced(payload: {
    studentId: string;
    count: number;
    entries: any[];
    syncedAt?: Date;
  }): void {
    const cleanId = String(payload.studentId || "").trim().replace(/\D/g, "");
    if (!cleanId) return;
    const p: TimetableSyncedPayload = {
      studentId: cleanId,
      count: payload.count,
      entries: payload.entries,
      syncedAt: payload.syncedAt || new Date(),
    };
    emit(`timetable:${cleanId}`, EVENT_NAMES.TIMETABLE_SYNCED, p);
  },

  // -------------------------------------------------------------------------
  // Event bus — notify-only (docs/rec-engine.md §6, issue #180). Emits
  // { eventId, type } only; consumers refetch via GET /api/v1/events.
  // -------------------------------------------------------------------------

  eventCreated(payload: EventFeedItemCreatedPayload): void {
    emit(`user:${payload.userId}`, EVENT_NAMES.EVENT_FEED_ITEM_CREATED, {
      eventId: payload.eventId,
      type: payload.eventType,
    });
  },

  // -------------------------------------------------------------------------
  // 24h-after-flag cron (docs/rec-engine.md §11, #11).
  // -------------------------------------------------------------------------

  recDelayed(payload: RecDelayedPayload): void {
    emit(`user:${payload.userId}`, EVENT_NAMES.REC_DELAYED, payload.recSet);
  },

  // -------------------------------------------------------------------------
  // In-session recommendation trigger (docs/rec-engine.md §10, #9).
  // -------------------------------------------------------------------------

  recInSession(payload: RecInSessionPayload): void {
    const p = {
      sessionId: payload.sessionId,
      concept: payload.concept,
      recSet: payload.recSet,
    };
    emit(`app:${payload.sessionId}`, EVENT_NAMES.REC_IN_SESSION, p);
    emit(`user:${payload.userId}`, EVENT_NAMES.REC_IN_SESSION, p);
  },
};

export async function publishEvent(channel: string, data: any) {
  try {
    logger.info(`[Publisher] Publishing event on channel ${channel}`);
    const message = JSON.stringify(data);
    await redisConnection.publish(channel, message);
    logger.info(
      `[Publisher] Event published on channel ${channel}: ${message}`,
    );
  } catch (error) {
    logger.error(
      `[Publisher] Failed to publish event on channel ${channel}:`,
      error,
    );
  }
}

// Internal helper — used across all publishers
export async function emit(
  roomId: string,
  event: string,
  payload: any,
): Promise<void> {
  try {
    const io = getIO();
    io.to(roomId).emit(event, payload);
    logger.info(`[Publisher] Event ${event} emitted to room ${roomId}`);
  } catch (_error) {
    // If Socket.io is not initialized in this process (e.g. background worker),
    // bridge event via Redis to the server process
    try {
      const data = {
        __isSocketSignal: true,
        __room: roomId,
        __event: event,
        payload,
      };
      await redisConnection.publish("app:worker:signals", JSON.stringify(data));
      logger.info(
        `[Publisher] Worker signal published via Redis for event ${event} to room ${roomId}`,
      );
    } catch (redisErr) {
      logger.error(
        `[Publisher] Failed to bridge event ${event} to room ${roomId} via Redis:`,
        redisErr,
      );
    }
  }
}

export default publishers;
