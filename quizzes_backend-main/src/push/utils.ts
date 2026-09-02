import { format, parseISO } from "date-fns";
import { PushPayload } from "./services";

export const pushPayloads = {
  examReminder: (
    courseCode: string,
    courseName: string,
    daysUntil: number,
    examDate: string,
    venue?: string,
    examMode?: string,
  ): PushPayload => {
    const formatted = format(parseISO(examDate), "EEE d MMM · h:mm a");

    // Title with exam mode if it's take-home, online, or sit-in
    let title = daysUntil === 0
      ? `${courseCode} exam is today`
      : `${courseCode} exam in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`;

    if (examMode) {
      const modeLower = examMode.toLowerCase().replace(/\s+/g, " ");
      if (modeLower.includes("take home") || modeLower.includes("take-home")) {
        title += " (TAKE-HOME)";
      } else if (modeLower.includes("online")) {
        title += " (ONLINE)";
      } else if (modeLower.includes("sit-in") || modeLower.includes("pen-to-paper")) {
        title += " (PEN-TO-PAPER)";
      }
    }

    // Body: course name, date/time, venue (already resolved for this student)
    let body = `${courseName} — ${formatted}`;
    if (venue) {
      body += ` · ${venue}`;
    }

    return {
      title,
      body,
      tag: `exam-reminder-${courseCode}`,
      url: "/timetable",
      data: { type: "exam_reminder", courseCode, examMode },
    };
  },

  quizAvailable: (
    quizTitle: string,
    courseCode: string,
    quizId: string,
  ): PushPayload => ({
    title: "New quiz available",
    body: `A new quiz has been published for ${courseCode}`,
    tag: `quiz-${quizId}`,
    url: `/quizzes/${quizId}`,
    data: { type: "quiz_available", quizId },
  }),

  studyPartnerRequest: (senderName: string): PushPayload => ({
    title: "New study partner request",
    body: `${senderName} wants to study with you`,
    tag: "study-partner-request",
    url: "/study-partners",
    data: { type: "study_partner_request" },
  }),

  studyPartnerMessage: (senderName: string, preview: string): PushPayload => ({
    title: senderName,
    body: preview,
    tag: `study-partner-message-${senderName}`,
    url: "/study-partners",
    data: { type: "study_partner_message" },
  }),

  programOfferingAvailable: (
    programName: string,
    programOfferingId: string,
  ): PushPayload => ({
    title: "Program now available",
    body: `${programName} is now offered at your university`,
    tag: `program-${programOfferingId}`,
    url: `/programs/${programOfferingId}`,
    data: { type: "program_offering_available", programOfferingId },
  }),

  approvalStatusChanged: (
    contentType: string,
    newStatus: string,
    contentTitle: string,
  ): PushPayload => ({
    title: `${contentType} ${newStatus}`,
    body: contentTitle,
    tag: "approval-status",
    url: "/content",
    data: { type: "approval_status_change" },
  }),

  recommendationUpdate: (): PushPayload => ({
    title: "Z has new recommendations",
    body: "Your study recommendations have been updated",
    tag: "recommendation-update",
    url: "/recommendations",
    data: { type: "recommendation_update" },
  }),

  courseAnnouncement: (courseCode: string, message: string): PushPayload => ({
    title: `${courseCode} announcement`,
    body: message,
    tag: `course-announcement-${courseCode}`,
    url: "/courses",
    data: { type: "course_announcement", courseCode },
  }),

  securityAlert: (message: string): PushPayload => ({
    title: "Security alert",
    body: message,
    tag: "security-alert",
    url: "/settings/security",
    data: { type: "security_alert" },
  }),

  accountActivity: (message: string): PushPayload => ({
    title: "Account activity",
    body: message,
    tag: "account-activity",
    url: "/settings",
    data: { type: "account_activity" },
  }),

  systemNotification: (title: string, body: string): PushPayload => ({
    title,
    body,
    tag: "system",
    url: "/",
    data: { type: "system_update" },
  }),

  generalNotification: (
    title: string,
    body: string,
    url?: string,
  ): PushPayload => ({
    title,
    body,
    tag: "general",
    url: url ?? "/",
    data: { type: "general" },
  }),
};
