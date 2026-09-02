import React from "react";
import { sendMail, EmailTemplate } from "@/mail";
import { Job, longQueue, shortQueue } from "../queues";
import { ENQUEUE_REMINDERS, PUBLISHERS } from "../utils";
import HANDLER_CONSTANTS from "../constants";
import { User } from "@/users";
import { Contact } from "@/contacts";
import { services as pushServices, utils as pushUtils } from "@/push";
import { services as emailServices } from "@/email";
import { CONFIG } from "@/config";
import { maskId } from "@/utils";
import { IVenueMapping } from "@/learning";
import { logger } from "@/config";

// -------------------------------------------------------------------------
// Push Notification Handlers
// -------------------------------------------------------------------------

export function registerHandlers(): void {
  logger.info("[Push Handler] Registering Push queue handlers...");
  shortQueue.register("push:exam_reminder", async (job: Job) => {
    const {
      userId,
      courseId,
      courseCode,
      courseName,
      daysUntil,
      examDate,
      label,
      venues,
      examMode,
    } = job.payload as {
      userId: string;
      courseId?: string;
      courseCode: string;
      courseName: string;
      daysUntil: number;
      examDate: string;
      label?: string;
      venues?: IVenueMapping[];
      examMode?: string;
    };

    const shouldSend = await ENQUEUE_REMINDERS.shouldEnqueueExamReminder({
      userId,
      courseRef: courseId || courseCode,
      examAtIso: examDate,
      daysUntil,
    });
    if (!shouldSend) return;

    const userDoc = await User.findById(userId).lean();
    const contactDoc = !userDoc ? await Contact.findById(userId).lean() : null;
    const targetUser = userDoc || contactDoc;
    if (!targetUser) return;

    const email = (userDoc ? userDoc.email : contactDoc?.email) || "";
    const username =
      (userDoc ? userDoc.username : contactDoc?.name) || "Student";
    const studentId = userDoc ? userDoc.studentId : contactDoc?.studentId;

    // Resolve the student's specific venue from their index number if available
    let studentVenue: string | undefined;
    if (studentId && venues?.length) {
      const studentIndex = parseInt(studentId, 10);
      if (!isNaN(studentIndex)) {
        const match = venues.find((v) => {
          if (!v.indexStart || !v.indexEnd) return false;
          return (
            studentIndex >= parseInt(v.indexStart, 10) &&
            studentIndex <= parseInt(v.indexEnd, 10)
          );
        });
        // If no index-range match but there's only one venue, use it directly
        const resolvedVenue =
          match ?? (venues.length === 1 ? venues[0] : undefined);
        studentVenue = resolvedVenue?.venue;
      }
    }

    // 1. Handle Push Notification (registered app users only)
    const pushEnabled =
      Boolean(userDoc) &&
      userDoc?.notificationSettings?.examReminders?.push !== false;
    if (pushEnabled) {
      await pushServices.sendToUser(
        userId,
        pushUtils.pushPayloads.examReminder(
          courseCode,
          courseName,
          daysUntil,
          examDate,
          studentVenue,
          examMode,
        ),
        "exam_reminder",
      );
    }

    // 2. Handle Email Notification via Campaign System (both users and contacts)
    const emailEnabled = userDoc
      ? userDoc.notificationSettings?.examReminders?.email !== false
      : Boolean(contactDoc?.isNewsletter);

    if (emailEnabled && email) {
      const timetableUrl = userDoc
        ? `${CONFIG.FRONTEND_URL}/app/timetable`
        : `${CONFIG.FRONTEND_URL}/timetable${studentId ? `?studentId=${encodeURIComponent(studentId)}` : ""}`;

      const venueHeader = studentVenue
        ? `### 📍 Your Assigned Venue\n**${studentVenue}**\n\n`
        : "";
      // Only show batch header if label is meaningful (not empty, not same as course name)
      const showBatch =
        label && label.trim() && label.trim() !== courseName.trim();
      const batchHeader = showBatch
        ? `### 🧾 Your Exam Batch\n**${label}**\n\n`
        : "";
      const venueTips =
        "4.  **Venue Finding**: If you're unsure of the exact location, **leave at least 30 minutes earlier** to find it.\n    *   *Pro-Tip*: Most UG campus locations and exam halls can be found via **Google Maps**.";

      const tipsMarkdown = `${venueHeader}${batchHeader}Use this to plan your route and timing in advance.\n\n### 📝 Exam Success Tips for ${courseCode}

To ensure everything goes smoothly, please keep these official University of Ghana tips in mind:

1.  **Identity Verification**: Don't forget your **University Student ID**. If you've misplaced it, visit your college office immediately for a temporary card.
2.  **Stationery**: Remember to bring your pens, pencils, and an approved calculator if allowed for this course.
3.  **Physical Prep**: Stay hydrated throughout the day and try to use the washroom before the paper begins.
${venueTips}

Good luck with your ${courseName} exam! You've got this.`;

      const campaign = await emailServices.sendTransactional({
        campaignType: "exam_reminder",
        recipient: {
          recipientId: userId,
          email,
          name: username,
        },
        subject:
          daysUntil === 0
            ? `Reminder: ${courseCode} exam is today!`
            : `Reminder: ${courseCode} exam in ${daysUntil} day${daysUntil === 1 ? "" : "s"}!`,
        markdownBody: tipsMarkdown,
        templateVariables: {
          courseCode,
          courseName,
          daysUntil,
          examDate,
          timetableUrl,
          ...(studentVenue && { venue: studentVenue }),
          ...(showBatch && label && { examBatch: label }),
        },
      });

      await shortQueue.enqueue("email:transactional:send", {
        campaignId: campaign._id.toString(),
        recipientId: userId,
        email,
        templateVariables: {
          name: username,
          timetableUrl,
        },
      });
    }

    await PUBLISHERS.publishNotificationEvent("notification:exam_reminder", {
      userId,
      courseCode,
      courseName,
      daysUntil,
      examDate,
      channels: { push: pushEnabled, email: emailEnabled },
    });
  });

  shortQueue.register("push:quiz_available", async (job: Job) => {
    const { userId, quizTitle, courseCode, quizId } = job.payload as {
      userId: string;
      quizTitle: string;
      courseCode: string;
      quizId: string;
    };

    const targetUser = await User.findById(userId).lean();
    if (!targetUser) return;

    // 1. Push notification
    const pushEnabled =
      targetUser.notificationSettings?.quizAvailability?.push !== false;
    if (pushEnabled) {
      await pushServices.sendToUser(
        userId,
        pushUtils.pushPayloads.quizAvailable(quizTitle, courseCode, quizId),
        "quiz_available",
      );
    }

    // 2. Email notification
    const emailEnabled =
      targetUser.notificationSettings?.quizAvailability?.email !== false;
    if (emailEnabled) {
      const quizUrl = `${CONFIG.FRONTEND_URL}/quizzes/${quizId}`;
      const markdownBody = `### New Quiz Available for ${courseCode}\n\nA new quiz has been published for **${courseCode}**. Head over to the quiz section to test your knowledge and track your progress.`;

      const campaign = await emailServices.sendTransactional({
        campaignType: "quiz_available",
        recipient: {
          recipientId: userId,
          email: targetUser.email,
          name: targetUser.name || targetUser.username,
        },
        subject: `New Quiz Available for ${courseCode}`,
        markdownBody,
        templateVariables: {
          quizTitle,
          courseCode,
          quizUrl,
        },
      });

      await shortQueue.enqueue("email:transactional:send", {
        campaignId: campaign._id.toString(),
        recipientId: userId,
        email: targetUser.email,
        templateVariables: {
          name: targetUser.name || targetUser.username,
          quizUrl,
        },
      });
    }

    await PUBLISHERS.publishNotificationEvent("notification:quiz_available", {
      userId,
      quizId,
      quizTitle,
      courseCode,
    });
  });

  shortQueue.register("push:study_partner_request", async (job: Job) => {
    const { userId, senderName } = job.payload as {
      userId: string;
      senderName: string;
    };
    await pushServices.sendToUser(
      userId,
      pushUtils.pushPayloads.studyPartnerRequest(senderName),
      "study_partner_request",
    );
    await PUBLISHERS.publishNotificationEvent(
      "notification:study_partner_request",
      {
        userId,
        senderName,
      },
    );
  });

  shortQueue.register("push:study_partner_message", async (job: Job) => {
    const { userId, senderName, preview } = job.payload as {
      userId: string;
      senderName: string;
      preview: string;
    };
    await pushServices.sendToUser(
      userId,
      pushUtils.pushPayloads.studyPartnerMessage(senderName, preview),
      "study_partner_message",
    );
    await PUBLISHERS.publishNotificationEvent(
      "notification:study_partner_message",
      {
        userId,
        senderName,
        preview,
      },
    );
  });

  shortQueue.register("push:program_offering_available", async (job: Job) => {
    const {
      subscriberUserIds,
      programName,
      programOfferingId,
      programId,
      universityId,
    } = job.payload as {
      subscriberUserIds: string[];
      programName: string;
      programOfferingId: string;
      programId: string;
      universityId: string;
    };
    await pushServices.sendToUsers(
      subscriberUserIds,
      pushUtils.pushPayloads.programOfferingAvailable(
        programName,
        programOfferingId,
      ),
      "program_offering_available",
    );
    for (const userId of subscriberUserIds) {
      await PUBLISHERS.publishNotificationEvent(
        "notification:program_offering_published",
        {
          userId,
          programOfferingId,
          programId,
          universityId,
          programName,
          publishedAt: new Date().toISOString(),
        },
      );
    }
  });

  shortQueue.register("push:recommendation_update", async (job: Job) => {
    const { userId } = job.payload as { userId: string };
    await pushServices.sendToUser(
      userId,
      pushUtils.pushPayloads.recommendationUpdate(),
      "recommendation_update",
    );
    await PUBLISHERS.publishNotificationEvent(
      "notification:recommendation_refresh_completed",
      {
        userId,
        refreshedAt: new Date().toISOString(),
        expiresAt: new Date(
          Date.now() + HANDLER_CONSTANTS.RECOMMENDATION_EXPIRY_MS,
        ).toISOString(),
      },
    );
  });

  shortQueue.register("push:approval_status_changed", async (job: Job) => {
    const { userId, contentType, newStatus, contentTitle, contentId } =
      job.payload as {
        userId: string;
        contentType: string;
        newStatus: string;
        contentTitle: string;
        contentId: string;
      };
    await pushServices.sendToUser(
      userId,
      pushUtils.pushPayloads.approvalStatusChanged(
        contentType,
        newStatus,
        contentTitle,
      ),
      "approval_status_change",
    );
    await PUBLISHERS.publishNotificationEvent(
      "notification:approval_status_changed",
      {
        userId,
        contentId,
        contentType,
        newStatus,
        changedAt: new Date().toISOString(),
      },
    );
  });

  shortQueue.register("push:course_announcement", async (job: Job) => {
    const { userIds, courseCode, message } = job.payload as {
      userIds: string[];
      courseCode: string;
      message: string;
    };
    await pushServices.sendToUsers(
      userIds,
      pushUtils.pushPayloads.courseAnnouncement(courseCode, message),
      "course_announcement",
    );
    for (const userId of userIds) {
      await PUBLISHERS.publishNotificationEvent(
        "notification:course_announcement",
        {
          userId,
          courseCode,
          message,
        },
      );
    }
  });

  shortQueue.register("push:security_alert", async (job: Job) => {
    const { userId, message } = job.payload as {
      userId: string;
      message: string;
    };
    await pushServices.sendToUser(
      userId,
      pushUtils.pushPayloads.securityAlert(message),
      "security_alert",
    );
    await PUBLISHERS.publishNotificationEvent("notification:security_alert", {
      userId,
      message,
    });
  });

  shortQueue.register("push:account_activity", async (job: Job) => {
    const { userId, message } = job.payload as {
      userId: string;
      message: string;
    };
    await pushServices.sendToUser(
      userId,
      pushUtils.pushPayloads.accountActivity(message),
      "account_activity",
    );
    await PUBLISHERS.publishNotificationEvent("notification:account_activity", {
      userId,
      message,
    });
  });

  shortQueue.register("notification:enrollment_update", async (job: Job) => {
    const { userId } = job.payload as { userId: string };
    const targetUser = await User.findById(userId).lean();
    if (!targetUser) return;

    const notificationTitle = "Enrollment Update";
    const notificationBody =
      "Some of your course enrollments were adjusted due to a system update. Please verify your course list to ensure you receive accurate exam alerts.";

    // 1. Send Push Notification
    const pushEnabled =
      targetUser.notificationSettings?.systemUpdates?.push !== false;
    if (pushEnabled) {
      await pushServices.sendToUser(
        userId,
        {
          title: notificationTitle,
          body: notificationBody,
          url: "/app/courses",
          tag: "enrollment-update",
          data: { type: "system_update" },
        },
        "system_update",
      );
    }

    // 2. Send Email Notification
    const emailEnabled =
      targetUser.notificationSettings?.systemUpdates?.email !== false;
    if (emailEnabled) {
      await sendMail({
        to: targetUser.email,
        subject: "Action Required: Your Course Enrollments have been updated",
        template: React.createElement(EmailTemplate, {
          category: "system",
          type: "notification",
          title: "Action Required: Course Enrollment Update",
          content: "",
          markdownBody: `We recently performed a system-wide update to standardize course codes (e.g., "DCIT 401" instead of "DCIT401").\n\nAs a result, some of your manual enrollments may have been adjusted. To ensure you continue to receive accurate exam reminders and timetable updates, please visit your **My Courses** page and verify that all your current courses are correctly listed.\n\n[Verify My Courses](${CONFIG.FRONTEND_URL}/app/courses)\n\nThank you for your patience,\nThe Qz Team`,
          email: targetUser.email,
          name: targetUser.name || targetUser.username || "Student",
          links: [
            {
              label: "Verify My Courses",
              url: `${CONFIG.FRONTEND_URL}/app/courses`,
            },
          ],
          variables: {
            name: targetUser.name || targetUser.username || "Student",
          },
        }),
      });
    }

    await PUBLISHERS.publishNotificationEvent(
      "notification:enrollment_update",
      {
        userId,
        channels: { push: pushEnabled, email: emailEnabled },
      },
    );
  });

  shortQueue.register("push:system_notification", async (job: Job) => {
    const { userIds, title, body } = job.payload as {
      userIds: string[];
      title: string;
      body: string;
    };
    await pushServices.sendToUsers(
      userIds,
      pushUtils.pushPayloads.systemNotification(title, body),
      "system_update",
    );
    for (const userId of userIds) {
      await PUBLISHERS.publishNotificationEvent(
        "notification:system_notification",
        {
          userId,
          title,
          body,
        },
      );
    }
  });

  shortQueue.register("push:test", async (job: Job) => {
    const { userId, title, body, url } = job.payload as {
      userId: string;
      title?: string;
      body?: string;
      url?: string;
    };

    const payloadTitle =
      typeof title === "string" && title.trim().length > 0
        ? title.trim()
        : "Test Push Notification";
    const payloadBody =
      typeof body === "string" && body.trim().length > 0
        ? body.trim()
        : "Your push notification setup is working.";

    const activeSubscriptions = await pushServices.getUserSubscriptions(userId);
    if (activeSubscriptions.length === 0) {
      await PUBLISHERS.publishNotificationEvent("notification:test_push", {
        userId,
        title: payloadTitle,
        body: payloadBody,
        success: false,
        reason: "No active push subscriptions found for this user",
        subscriptionCount: 0,
      });
      logger.info(
        `[push:test] No active subscriptions found for user ${maskId(userId)}`,
      );
      return;
    }

    try {
      await pushServices.sendToUser(
        userId,
        {
          title: payloadTitle,
          body: payloadBody,
          tag: "test-push",
          url: url ?? "/",
          data: {
            type: "test_push",
            forceShow: true,
          },
        },
        "system_update",
      );

      await PUBLISHERS.publishNotificationEvent("notification:test_push", {
        userId,
        title: payloadTitle,
        body: payloadBody,
        success: true,
        subscriptionCount: activeSubscriptions.length,
      });
    } catch (error: any) {
      logger.error(
        `[push:test] Failed to send test push to user ${maskId(userId)}:`,
        error?.message,
      );
      await PUBLISHERS.publishNotificationEvent("notification:test_push", {
        userId,
        title: payloadTitle,
        body: payloadBody,
        success: false,
        reason: error?.message ?? "Unknown push send failure",
        subscriptionCount: activeSubscriptions.length,
      });
      throw error;
    }
  });

  longQueue.register("push:sweep_invalid", async () => {
    await pushServices.sweepInvalidSubscriptions();
  });
}
