import { Job, longQueue, shortQueue } from "../queues";
import {
  ExamTimetable,
  UserCourseEnrollment,
  LibraryMaterial,
  MaterialChunk,
  Quiz,
  services as learningServices,
} from "@/learning";
import HANDLER_CONSTANTS from "../constants";
import {
  ENQUEUE_REMINDERS,
  PUBLISHERS,
  normalizeForMatch,
  buildPublicPreExamQuizJobId,
} from "../utils";
import { services as pushServices } from "@/push";
import { User } from "@/users";
import { services as emailServices } from "@/email";
import { runMigrations } from "@/migrations/runner";
import { services as featuresServices } from "@/features";
import { logger } from "@/config";
import { maskId } from "@/utils";

// -------------------------------------------------------------------------
// System Handlers
// -------------------------------------------------------------------------

export function registerHandlers(): void {
  logger.info("[System Handler] Registering System queue handlers...");
  longQueue.register("timetable:daily_sweep", async () => {
    const now = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);

    // Find all published timetables with sessions in the next 7 days
    const activeTimetables = await ExamTimetable.find({
      isPublished: true,
      "entries.sessions.scheduledAt": { $gte: now, $lte: nextWeek },
    }).lean();

    const enrollmentCache = new Map<string, Array<{ userId?: any }>>();

    for (const timetable of activeTimetables) {
      for (const entry of timetable.entries) {
        for (const session of entry.sessions) {
          const scheduledAt = new Date(session.scheduledAt);

          if (scheduledAt >= now && scheduledAt <= nextWeek) {
            // Find students enrolled in this course for this semester
            // const enrollments = await UserCourseEnrollment.find({
            //   courseId: entry.courseId,
            //   semester: timetable.semester,
            //   academicYear: timetable.academicYear,
            // })
            //   .select("userId")
            //   .lean();

            const cacheKey = `${entry.courseId}:${timetable.semester}:${timetable.academicYear}`;

            let enrollments = enrollmentCache.get(cacheKey);

            if (!enrollments) {
              enrollments = await UserCourseEnrollment.find({
                courseId: entry.courseId,
                semester: timetable.semester,
                academicYear: timetable.academicYear,
              })
                .select("userId")
                .lean();
              enrollmentCache.set(cacheKey, enrollments);
            }

            const userIds = (enrollments || [])
              .map((e) => e.userId)
              .filter(Boolean);

            for (const userId of userIds) {
              // Calculate calendar days away (matches frontend getCalendarDaysAway logic)
              const examDate = new Date(scheduledAt);
              const examStart = new Date(
                examDate.getFullYear(),
                examDate.getMonth(),
                examDate.getDate(),
              ).getTime();
              const nowDate = new Date(now);
              const nowStart = new Date(
                nowDate.getFullYear(),
                nowDate.getMonth(),
                nowDate.getDate(),
              ).getTime();
              const daysUntil = Math.round(
                (examStart - nowStart) / (1000 * 60 * 60 * 24),
              );

              if ([7, 3, 1].includes(daysUntil)) {
                await shortQueue.enqueue("push:exam_reminder", {
                  userId: String(userId),
                  courseId: String(entry.courseId),
                  courseCode: entry.courseCode,
                  courseName: entry.courseName,
                  daysUntil,
                  examDate: scheduledAt.toISOString(),
                  label: session.label,
                  venues: session.venues,
                });
              }
            }
          }
        }
      }
    }
  });

  longQueue.register("quiz:public_preexam_sweep", async () => {
    if (!(await featuresServices.isEnabled("public_preexam_autogen"))) {
      logger.info(
        "[Scheduler] quiz:public_preexam_sweep skipped (feature flag off)",
      );
      return;
    }

    const now = new Date();
    const targetStart = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + HANDLER_CONSTANTS.PUBLIC_PREEXAM_QUIZ_OFFSETS_DAYS,
        0,
        0,
        0,
        0,
      ),
    );
    const targetEnd = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() +
          HANDLER_CONSTANTS.PUBLIC_PREEXAM_QUIZ_OFFSETS_DAYS +
          1,
        0,
        0,
        0,
        0,
      ),
    );

    const activeTimetables = await ExamTimetable.find({
      isPublished: true,
      "entries.sessions.scheduledAt": { $gte: targetStart, $lt: targetEnd },
    }).lean();

    for (const timetable of activeTimetables) {
      for (const entry of timetable.entries) {
        const entryId = String((entry as any)._id || entry.courseId);
        for (const examSession of entry.sessions) {
          const scheduledAt = new Date(examSession.scheduledAt);
          if (!(scheduledAt >= targetStart && scheduledAt < targetEnd)) {
            continue;
          }

          const examSessionId = String(
            (examSession as any).sessionId || (examSession as any)._id,
          );
          const courseId = String(entry.courseId);
          const rootDedupeOk =
            await ENQUEUE_REMINDERS.shouldEnqueuePublicPreExamQuiz({
              examEntryId: entryId,
              sessionId: examSessionId,
              courseId,
            });
          if (!rootDedupeOk) {
            await ENQUEUE_REMINDERS.incrementPublicPreExamMetric(
              "skipped_duplicate",
            );
            continue;
          }

          await ENQUEUE_REMINDERS.incrementPublicPreExamMetric("attempted");

          const normalizedCode = normalizeForMatch(entry.courseCode || "");
          const normalizedName = normalizeForMatch(entry.courseName || "");

          const exactMaterials = await LibraryMaterial.find({
            status: "published",
            courseId: entry.courseId,
          })
            .sort({ useCount: -1, publishedAt: -1, createdAt: -1 })
            .lean();

          const fallbackMaterials =
            exactMaterials.length > 0
              ? exactMaterials
              : await LibraryMaterial.find({
                  status: "published",
                  $or: [
                    { title: { $regex: entry.courseCode, $options: "i" } },
                    { title: { $regex: entry.courseName, $options: "i" } },
                    { subject: { $regex: entry.courseCode, $options: "i" } },
                    { subject: { $regex: entry.courseName, $options: "i" } },
                  ],
                })
                  .sort({ useCount: -1, publishedAt: -1, createdAt: -1 })
                  .lean();

          const matchedMaterials = (
            exactMaterials.length > 0 ? exactMaterials : fallbackMaterials
          ).filter((material) => {
            if (material.courseId && String(material.courseId) === courseId) {
              return true;
            }

            const titleNorm = normalizeForMatch(
              `${material.title || ""} ${material.subject || ""}`,
            );
            return (
              (normalizedCode && titleNorm.includes(normalizedCode)) ||
              (normalizedName && titleNorm.includes(normalizedName))
            );
          });

          if (matchedMaterials.length === 0) {
            await ENQUEUE_REMINDERS.incrementPublicPreExamMetric(
              "skipped_no_material",
            );
            logger.info(
              `[Scheduler] quiz:public_preexam_sweep no material match for ${entry.courseCode}`,
            );
            continue;
          }

          const materialIds = matchedMaterials.map((m) => m.materialId);
          const chunks = await MaterialChunk.find({
            materialId: { $in: materialIds },
          })
            .select("section text pageNumber")
            .sort({ pageNumber: 1, section: 1, chunkId: 1 })
            .lean();

          const lectureMap = new Map<
            string,
            { title: string; seedText: string; pageNumber: number }
          >();
          for (const chunk of chunks) {
            const sectionTitle =
              typeof chunk.section === "string" &&
              chunk.section.trim().length > 0
                ? chunk.section.trim()
                : "General";
            const lectureKey =
              normalizeForMatch(sectionTitle).slice(0, 40) || "general";
            if (!lectureMap.has(lectureKey)) {
              lectureMap.set(lectureKey, {
                title: sectionTitle,
                seedText: String(chunk.text || "").slice(0, 500),
                pageNumber: Number(chunk.pageNumber || 0),
              });
            }
          }

          if (lectureMap.size === 0) {
            lectureMap.set("general", {
              title: "General",
              seedText: `${entry.courseCode} ${entry.courseName}`.trim(),
              pageNumber: 0,
            });
          }

          const lectureCandidates = [...lectureMap.entries()]
            .map(([key, value]) => ({ key, ...value }))
            .sort((a, b) => a.pageNumber - b.pageNumber);

          const quizTag = `auto_preexam:${entryId}:${examSessionId}`;
          let targetQuiz = await Quiz.findOne({
            courseId: entry.courseId,
            tags: quizTag,
          })
            .select("_id lectures")
            .lean();

          if (!targetQuiz) {
            targetQuiz = await Quiz.create({
              title: `${entry.courseCode} Pre-Exam Auto Quiz`,
              description: `Auto-generated study quiz for ${entry.courseCode} scheduled on ${scheduledAt.toISOString()}.`,
              courseId: entry.courseId,
              createdBy: timetable.createdBy,
              status: "published",
              isAvailable: true,
              passingScore: 70,
              tags: [quizTag, "public_preexam"],
              lectures: [],
            });
          }

          const existingLectureTitles = new Set(
            ((targetQuiz as any).lectures || []).map((l: any) =>
              normalizeForMatch(String(l.title || "")),
            ),
          );

          for (const lecture of lectureCandidates) {
            const lectureDedupeOk =
              await ENQUEUE_REMINDERS.shouldEnqueuePublicPreExamQuiz({
                examEntryId: entryId,
                sessionId: examSessionId,
                courseId,
                lectureKey: lecture.key,
              });
            if (!lectureDedupeOk) {
              await ENQUEUE_REMINDERS.incrementPublicPreExamMetric(
                "skipped_duplicate",
              );
              continue;
            }

            if (existingLectureTitles.has(normalizeForMatch(lecture.title))) {
              await ENQUEUE_REMINDERS.incrementPublicPreExamMetric(
                "skipped_duplicate",
              );
              continue;
            }

            const lectureJobId = buildPublicPreExamQuizJobId({
              examEntryId: entryId,
              sessionId: examSessionId,
              courseId,
              lectureKey: lecture.key,
            });

            await longQueue.enqueue(
              "ai:generate_quiz",
              {
                quizId: String((targetQuiz as any)._id),
                courseId,
                topic:
                  `${entry.courseCode} ${lecture.title}\n\nReference:\n${lecture.seedText}`.trim(),
                numberOfQuestions: 12,
                questionTypes: ["mcq", "true-false", "fill-in"],
                difficulty: "mixed",
                lectureTitle: lecture.title,
                createdBy: String(timetable.createdBy),
                jobId: lectureJobId,
                autoContext: {
                  source: "public_preexam",
                  examEntryId: entryId,
                  examSessionId,
                  examAt: scheduledAt.toISOString(),
                  lectureKey: lecture.key,
                },
              },
              3,
              lectureJobId,
            );
            await ENQUEUE_REMINDERS.incrementPublicPreExamMetric("generated");
          }
        }
      }
    }
  });

  longQueue.register("scrape:school_timetable", async () => {
    try {
      await learningServices.syncSchoolTimetable();
      logger.info("[Scheduler] scrape:school_timetable completed successfully");
    } catch (error: any) {
      logger.error(
        `[Scheduler] scrape:school_timetable failed: ${error.message}`,
      );
      throw error;
    }
  });

  longQueue.register(
    "timetable:enroll_user_courses_from_timetable",
    async (job: Job) => {
      const { userId, studentId } = job.payload as {
        userId?: string;
        studentId?: string;
      };
      if (!studentId) return;

      try {
        await learningServices.syncTimetableByStudentId(studentId, userId);
      } catch (error: any) {
        logger.error(
          `[Worker] Failed to sync timetable for student ${maskId(studentId)}: ${error.message}`,
        );
      }
    },
  );

  longQueue.register("timetable:reconcile_reminders", async (job: Job) => {
    const { timetableId } = job.payload as { timetableId?: string };
    if (!timetableId) return;

    try {
      const timetable = await ExamTimetable.findById(timetableId).lean();
      if (timetable) {
        await learningServices.syncTimetableReminderJobs(timetable as any);
      }
    } catch (error: any) {
      logger.error(
        `[Worker] Failed to reconcile timetable reminders: ${error.message}`,
      );
    }
  });

  longQueue.register("admin:sync_school_timetable", async (job: Job) => {
    try {
      const { startDate, days, semester, academicYear } = job.payload as {
        startDate?: string;
        days?: number;
        semester?: string;
        academicYear?: string;
      };

      const start = startDate ? new Date(startDate) : new Date();
      logger.info(
        `[Worker] Starting sequential STS sync from ${start.toISOString()}`,
      );

      await learningServices.syncSchoolTimetable(
        start,
        days,
        semester,
        academicYear,
        true,
      );

      logger.info(
        "[Worker] admin:sync_school_timetable completed successfully",
      );
    } catch (error: any) {
      logger.error(
        `[Worker] admin:sync_school_timetable failed: ${error.message}`,
      );
      throw error;
    }
  });

  longQueue.register("scrape:daily_confirmation", async () => {
    // 1. Re-scrape today's timetable data (best-effort; don't block the push sweep)
    try {
      const today = new Date();
      await learningServices.syncSchoolTimetable(
        today,
        1,
        "Semester 1",
        "2025-2026",
        true,
      );
      logger.info("[Scheduler] scrape:daily_confirmation completed");
    } catch (error: any) {
      logger.error(
        `[Scheduler] scrape:daily_confirmation failed: ${error.message}`,
      );
      // Don't rethrow — proceed with morning push sweep using existing timetable data
    }

    // 2. Morning-of reminder sweep (runs at 05:00 UTC, ~2.5h before earliest 7:30am papers)
    // Finds all exams happening today and sends a same-day push to enrolled students.
    try {
      const now = new Date();
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);

      const todaysTimetables = await ExamTimetable.find({
        isPublished: true,
        "entries.sessions.scheduledAt": { $gte: now, $lte: endOfDay },
      }).lean();

      for (const timetable of todaysTimetables) {
        for (const entry of timetable.entries) {
          for (const session of entry.sessions) {
            const scheduledAt = new Date(session.scheduledAt);
            if (scheduledAt < now || scheduledAt > endOfDay) continue;

            const enrollments = await UserCourseEnrollment.find({
              courseId: entry.courseId,
              semester: timetable.semester,
              academicYear: timetable.academicYear,
              status: "active",
            })
              .select("userId contactId")
              .lean();

            for (const enrollment of enrollments) {
              const targetId = enrollment.userId || enrollment.contactId;
              if (!targetId) continue;

              // Calendar days away for today's exams is always 0
              await shortQueue.enqueue("push:exam_reminder", {
                userId: String(targetId),
                courseId: String(entry.courseId),
                courseCode: entry.courseCode,
                courseName: entry.courseName,
                daysUntil: 0,
                examDate: scheduledAt.toISOString(),
                label: session.label,
                venues: session.venues,
              });
            }
          }
        }
      }
      logger.info("[Scheduler] morning-of exam reminder sweep completed");
    } catch (err: any) {
      logger.error(`[Scheduler] morning-of exam sweep failed: ${err.message}`);
    }
  });

  shortQueue.register("push:timetable_change", async (job: Job) => {
    try {
      const { userId, title, body, type, metadata } = job.payload as {
        userId: string;
        title: string;
        body: string;
        type: string;
        metadata: any;
      };
      const targetUser = await User.findById(userId).lean();
      if (!targetUser) return;

      // 1. Handle External Channels (Push & Email)
      await pushServices.sendToUser(
        userId,
        { title, body, data: metadata },
        "course_announcement", // Maps to courseAnnouncements settings
      );

      const emailEnabled =
        targetUser.notificationSettings?.courseAnnouncements?.email !== false;
      if (emailEnabled) {
        const campaign = await emailServices.sendTransactional({
          campaignType: "announcement",
          recipient: {
            recipientId: userId,
            email: targetUser.email,
            name: targetUser.username,
          },
          subject: title,
          markdownBody: body,
          templateVariables: {
            name: targetUser.username,
          },
        });

        await shortQueue.enqueue("email:transactional:send", {
          campaignId: campaign._id.toString(),
          recipientId: userId,
          email: targetUser.email,
          templateVariables: {
            name: targetUser.username,
          },
        });
      }

      // 2. Handle In-App (Socket) Notification
      await PUBLISHERS.publishNotificationEvent(type || "timetable_change", {
        userId,
        title,
        body,
        metadata,
        isUrgent: type === "urgent_timetable_alert",
      });

      logger.info(
        `[Worker] Dispatched timetable change alerts for user ${userId}`,
      );
    } catch (error: any) {
      logger.error(`[Worker] push:timetable_change failed: ${error.message}`);
    }
  });

  longQueue.register("system:run_migrations", async (job: Job) => {
    const { adminId, adminEmail, rerun, migrationIds } = job.payload as {
      adminId: string;
      adminEmail: string;
      rerun?: boolean;
      migrationIds?: string[];
    };

    try {
      logger.info(
        `[Worker] Starting system:run_migrations (rerun=${rerun === true})...`,
      );

      if (adminId) {
        await PUBLISHERS.publishNotificationEvent("migration_started", {
          userId: adminId,
          title: "Database Migration Started",
          body:
            Array.isArray(migrationIds) && migrationIds.length > 0
              ? rerun === true
                ? `Rerunning ${migrationIds.length} selected migration script(s).`
                : `Running ${migrationIds.length} selected pending migration script(s).`
              : rerun === true
                ? "Rerun mode is active. Reapplying migration scripts."
                : "Applying pending database migrations.",
          metadata: {
            rerun: rerun === true,
            migrationIds:
              Array.isArray(migrationIds) && migrationIds.length > 0
                ? migrationIds
                : undefined,
          },
        });
      }

      const result = await runMigrations(undefined, {
        rerun: rerun === true,
        migrationIds:
          Array.isArray(migrationIds) && migrationIds.length > 0
            ? migrationIds
            : undefined,
      });

      if (result.success) {
        logger.info(
          `[Worker] system:run_migrations completed. Executed: ${result.executed.join(", ") || "None"}`,
        );

        // 1. Send Push Notification to initiating admin
        if (adminId) {
          await PUBLISHERS.publishNotificationEvent("migration_complete", {
            userId: adminId,
            title: "Database Migration Success",
            body: `Successfully executed ${result.executed.length} migration(s).`,
            metadata: {
              executed: result.executed,
              rerun: rerun === true,
              migrationIds:
                Array.isArray(migrationIds) && migrationIds.length > 0
                  ? migrationIds
                  : undefined,
            },
          });
        }

        // 2. Send Email Notification to initiating admin via Transactional System
        if (adminEmail) {
          const executedList =
            result.executed.length > 0
              ? result.executed.map((name) => `- ${name}`).join("\n")
              : "No pending migrations were found.";

          const campaign = await emailServices.sendTransactional({
            campaignType: "system_update",
            recipient: {
              recipientId: adminId || "system",
              email: adminEmail,
              name: "Administrator",
            },
            subject: "[Qz] Database Migration Complete",
            markdownBody: `## Database migrations completed successfully.\n\n**Run Mode:** ${
              Array.isArray(migrationIds) && migrationIds.length > 0
                ? rerun === true
                  ? `Targeted rerun (${migrationIds.length} selected)`
                  : `Targeted pending run (${migrationIds.length} selected)`
                : rerun === true
                  ? "Rerun all scripts"
                  : "Pending only"
            }\n\n**Executed Scripts:**\n${executedList}\n\nAll systems are operational.`,
            templateVariables: {
              name: "Administrator",
            },
          });

          await shortQueue.enqueue("email:transactional:send", {
            campaignId: campaign._id.toString(),
            recipientId: adminId || "system",
            email: adminEmail,
            templateVariables: {
              name: "Administrator",
            },
          });
        }
      } else {
        const errorMsg =
          result.error || "Migration failed without error message";
        logger.error(`[Worker] system:run_migrations failed: ${errorMsg}`);

        // Notify of failure
        if (adminId) {
          await PUBLISHERS.publishNotificationEvent("migration_failed", {
            userId: adminId,
            title: "Database Migration Failed",
            body: errorMsg,
            isUrgent: true,
          });
        }

        if (adminEmail) {
          const campaign = await emailServices.sendTransactional({
            campaignType: "system_update",
            recipient: {
              recipientId: adminId || "system",
              email: adminEmail,
              name: "Administrator",
            },
            subject: "[Qz] ALERT: Database Migration Failed",
            markdownBody: `## A database migration attempt failed.\n\n**Error:**\n> ${errorMsg}\n\nPlease check the system logs immediately to resolve the inconsistency.`,
            templateVariables: {
              name: "Administrator",
            },
          });

          await shortQueue.enqueue("email:transactional:send", {
            campaignId: campaign._id.toString(),
            recipientId: adminId || "system",
            email: adminEmail,
            templateVariables: {
              name: "Administrator",
            },
          });
        }

        throw new Error(errorMsg);
      }
    } catch (error: any) {
      logger.error(`[Worker] system:run_migrations error: ${error.message}`);
      throw error;
    }
  });

  longQueue.register("streak:daily_sweep", async (_job: Job) => {
    try {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      // Find users with an active streak who haven't studied today or yesterday
      // and whose streak hasn't already been reset (currentCount > 0)
      const inactiveUsers = await User.find({
        "streak.currentCount": { $gt: 0 },
        "streak.pausedForBreak": { $ne: true },
        "streak.lastStudyDate": { $lt: twoDaysAgo },
      })
        .select("_id streak")
        .lean();

      let resetCount = 0;
      for (const user of inactiveUsers) {
        const lastStudy = user.streak?.lastStudyDate
          ? new Date(user.streak.lastStudyDate)
          : null;
        if (!lastStudy) continue;

        const daysSince = Math.floor(
          (now.getTime() - lastStudy.getTime()) / (24 * 60 * 60 * 1000),
        );

        // Forgiving renewal window: 2 days missed, 9+ streak, restore not used
        const canRestore =
          daysSince <= 3 &&
          (user.streak?.currentCount ?? 0) >= 9 &&
          !user.streak?.restoreUsedThisTerm;

        if (!canRestore) {
          await User.updateOne(
            { _id: user._id },
            { $set: { "streak.currentCount": 0 } },
          );
          resetCount++;
        }
      }

      logger.info(`[streak:daily_sweep] Reset ${resetCount} broken streaks.`);
    } catch (error: any) {
      logger.error("[streak:daily_sweep] Error:", error.message);
      throw error;
    }
  });

  longQueue.register("student:reverify_sweep", async (_job: Job) => {
    try {
      const now = new Date();
      const twoWeeksFromNow = new Date(
        now.getTime() + 14 * 24 * 60 * 60 * 1000,
      );

      // 1. Lapse verified users whose expiry has passed
      const lapseResult = await User.updateMany(
        {
          "studentVerification.status": "verified",
          "studentVerification.expiresAt": { $lt: now },
        },
        { $set: { "studentVerification.status": "lapsed" } },
      );

      // 2. Find verified users whose expiry is within 14 days — send reminder
      const soonToExpire = await User.find({
        "studentVerification.status": "verified",
        "studentVerification.expiresAt": { $gte: now, $lte: twoWeeksFromNow },
      })
        .select("_id email name studentVerification")
        .lean();

      for (const user of soonToExpire) {
        await shortQueue.enqueue("email:student_reverify_reminder", {
          userId: String(user._id),
          email: user.email,
          name: user.name,
          expiresAt: user.studentVerification?.expiresAt,
        });
      }

      logger.info(
        `[student:reverify_sweep] Lapsed: ${lapseResult.modifiedCount}, Reminder sent: ${soonToExpire.length}`,
      );
    } catch (error: any) {
      logger.error("[student:reverify_sweep] Error:", error.message);
      throw error;
    }
  });

  longQueue.register("subscription:expire_sweep", async (_job: Job) => {
    try {
      const { Subscription } = await import("@/subscriptions/models.js");
      const now = new Date();

      // Find all active subscriptions that have passed their end date
      const expiredSubscriptions = await Subscription.find({
        status: "active",
        endDate: { $lt: now },
      }).lean();

      if (expiredSubscriptions.length === 0) {
        logger.info(
          "[subscription:expire_sweep] No expired subscriptions found.",
        );
        return;
      }

      const expiredIds = expiredSubscriptions.map(
        (s: { _id: import("mongoose").Types.ObjectId }) => s._id,
      );
      const affectedUserIds = [
        ...new Set(
          expiredSubscriptions.map(
            (s: { userId: import("mongoose").Types.ObjectId }) =>
              String(s.userId),
          ),
        ),
      ];

      // Mark subscriptions as expired
      await Subscription.updateMany(
        { _id: { $in: expiredIds as import("mongoose").Types.ObjectId[] } },
        { $set: { status: "expired" } },
      );

      // For each affected user, check if they still have ANY active subscription
      for (const userId of affectedUserIds) {
        const activeRemaining = await Subscription.countDocuments({
          userId: userId as string,
          status: "active",
        });

        if (activeRemaining === 0) {
          await User.updateOne(
            { _id: userId as string },
            {
              $set: {
                isSubscribed: false,
                planTier: null,
                planDuration: null,
              },
            },
          );
        }
      }

      logger.info(
        `[subscription:expire_sweep] Expired ${expiredIds.length} subscriptions across ${affectedUserIds.length} users.`,
      );
    } catch (error: any) {
      logger.error("[subscription:expire_sweep] Error:", error.message);
      throw error;
    }
  });

  longQueue.register("system:redis_cleanup", async () => {
    logger.info("[Worker] Starting Redis cleanup (GC)...");
    try {
      const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

      // 1. Clean failed jobs older than 1 week
      const cleanedShortFailed = await shortQueue.clean(
        ONE_WEEK_MS,
        1000,
        "failed",
      );
      const cleanedLongFailed = await longQueue.clean(
        ONE_WEEK_MS,
        1000,
        "failed",
      );

      // 2. Clean completed jobs (safety net, usually auto-deleted)
      const cleanedShortComp = await shortQueue.clean(0, 1000, "completed");
      const cleanedLongComp = await longQueue.clean(0, 1000, "completed");

      logger.info(
        `[Worker] Redis GC complete. ` +
          `Cleaned: ${cleanedShortFailed.length + cleanedLongFailed.length} failed jobs, ` +
          `${cleanedShortComp.length + cleanedLongComp.length} completed jobs.`,
      );
    } catch (err: any) {
      logger.error("[Worker] Redis GC failed:", err.message);
    }
  });
}
