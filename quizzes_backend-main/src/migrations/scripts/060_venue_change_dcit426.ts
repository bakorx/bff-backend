import { Mongoose } from "mongoose";
import { UserCourseEnrollment, ExamTimetable } from "@/learning/models";
import { User } from "@/users";
import { Contact } from "@/contacts";
import { PushSubscription } from "@/push/models";
import { shortQueue } from "@/schedulers";
import { services as emailServices } from "@/email";
import { services as pushServices, utils as pushUtils } from "@/push";
import { logger } from "@/config";

/**
 * Migration 060: Send venue change notification for DCIT 426
 *
 * Sends both email and push notifications to ALL users and contacts who have
 * registered for exam reminders (DCIT 426), IGNORING their notification
 * preferences (one-off migration).
 *
 * - Email: sent via transactional email campaign (campaignType: exam_reminder)
 * - Push: sent to all registered push subscriptions regardless of settings
 *
 * The assignment will be published via the course official WhatsApp group.
 */
export async function up(mongoose: Mongoose) {
  logger.info("Starting migration: 060_venue_change_dcit426 (one-off, ignores prefs)...");

  try {
    // 1. Find the DCIT 426 exam entry from published exam timetables
    const timetables = await ExamTimetable.find({
      isPublished: true,
      "entries.courseCode": "DCIT 426",
    }).lean();

    if (!timetables || timetables.length === 0) {
      logger.info(
        "[DCIT 426] No published exam timetable found for DCIT 426",
      );
      return;
    }

    // Use the first matching timetable
    const timetable = timetables[0];

    // Find the entry for DCIT 426
    const entry = timetable.entries.find(
      (e: any) => e.courseCode === "DCIT 426",
    );

    if (!entry) {
      logger.info(
        "[DCIT 426] No exam entry found in published timetables for DCIT 426",
      );
      return;
    }

    logger.info(
      `[DCIT 426] Found exam entry: ${entry.courseName} (${entry.courseCode})`,
    );

    // The email body used for both email and push notifications
    const emailBody = `This is to inform you that **DCIT 426** will be a **take-home exam**.

The assignment will be published via the **course official WhatsApp group**. Please keep an eye on the group for the exam details and instructions.

Be ready to complete it once it is posted. If you have any questions, please reach out to the course instructor through the official channel.

--
This is an automated notification from the Qz platform.
`;

    // 2. Find all active students enrolled in DCIT 426 (users)
    const enrollments = await UserCourseEnrollment.find({
      courseId: entry.courseId,
      status: "active",
    })
      .select("userId")
      .lean();

    logger.info(
      `[DCIT 426] Found ${enrollments.length} active enrollments`,
    );

    // 3. Find all contacts who opted for exam reminders
    const contacts = await Contact.find({
      source: "timetable_reminder",
    })
      .lean();

    logger.info(
      `[DCIT 426] Found ${contacts.length} contacts opted for exam reminders`,
    );

    // 4. For each enrolled user, look up their user details and send email + push
    let emailSentCount = 0;
    let pushSentCount = 0;
    let errorCount = 0;

    for (const enrollment of enrollments) {
      try {
        // Look up the user document to get email, name, and studentId
        const user = await User.findById(enrollment.userId)
          .select("email name studentId notificationSettings")
          .lean();

        if (!user) {
          logger.warn(
            `[DCIT 426] User not found for enrollment ${enrollment._id}`,
          );
          errorCount++;
          continue;
        }

        // ---- EMAIL ----
        // Create a transactional email campaign (direct send, bypassing preference checks)
        const campaign = await emailServices.sendTransactional({
          campaignType: "exam_reminder",
          recipient: {
            recipientId: user._id,
            email: user.email,
            name: user.name,
          },
          subject: "DCIT 426 - Take-Home Exam Notice",
          markdownBody: emailBody,
          templateVariables: {
            courseCode: "DCIT 426",
            courseName: entry.courseName,
            studentName: user.name || "Student",
          },
        });

        // Enqueue for delivery via the email:transactional:send worker
        await shortQueue.enqueue("email:transactional:send", {
          campaignId: campaign._id.toString(),
          recipientId: user._id.toString(),
          email: user.email,
          templateVariables: {
            name: user.name,
            courseCode: "DCIT 426",
          },
        });

        emailSentCount++;
        logger.info(
          `[DCIT 426] Email campaign queued for ${user.email}`,
        );

        // ---- PUSH ----
        // Send push notification directly, IGNORING notification preferences
        // Find all active push subscriptions for this user using the full Mongoose document
        const subscriptions = await PushSubscription.find({
          userId: user._id,
          isActive: true,
        });

        for (const sub of subscriptions) {
          try {
            const pushPayload = {
              title: "DCIT 426 - Take-Home Exam",
              body: `DCIT 426 will be a take-home exam. The assignment will be published via the course official WhatsApp group.`,
              tag: "dcit-426-take-home",
              url: "/timetable",
              data: { type: "take_home_exam", courseCode: "DCIT 426" },
            };

            await pushServices.sendToSubscription(sub, pushPayload);
            pushSentCount++;
            logger.info(
              `[DCIT 426] Push sent to subscription ${String(sub.endpoint).substring(
                0,
                30,
              )}...`,
            );
          } catch (subErr: any) {
            logger.error(
              `[DCIT 426] Failed push to subscription:`,
              subErr.message,
            );
            // Continue to next subscription on error
          }
        }

      } catch (err: any) {
        errorCount++;
        logger.error(
          `[DCIT 426] Failed to process enrollment ${enrollment.userId}:`,
          err.message,
        );
      }
    }

    // 5. Send email to all contacts who opted for exam reminders
    for (const contact of contacts) {
      try {
        // Send email directly via sendTransactional + shortQueue
        const campaign = await emailServices.sendTransactional({
          campaignType: "exam_reminder",
          recipient: {
            recipientId: contact._id,
            email: contact.email,
            name: contact.name || "Student",
          },
          subject: "DCIT 426 - Take-Home Exam Notice",
          markdownBody: emailBody,
          templateVariables: {
            courseCode: "DCIT 426",
            courseName: entry.courseName,
            studentName: contact.name || "Student",
          },
        });

        // Enqueue for delivery via the email:transactional:send worker
        await shortQueue.enqueue("email:transactional:send", {
          campaignId: campaign._id.toString(),
          recipientId: contact._id.toString(),
          email: contact.email,
          templateVariables: {
            name: contact.name || "Student",
            courseCode: "DCIT 426",
          },
        });

        emailSentCount++;
        logger.info(
          `[DCIT 426] Email campaign queued for contact ${contact.email}`,
        );
      } catch (err: any) {
        errorCount++;
        logger.error(
          `[DCIT 426] Failed to process contact ${contact.email}:`,
          err.message,
        );
      }
    }

    logger.info(
      `[DCIT 426] Migration completed. Emails queued: ${emailSentCount}, Push sent: ${pushSentCount}, Errors: ${errorCount}`,
    );
  } catch (error: any) {
    logger.error("[DCIT 426] Migration failed:", error.message);
    throw error;
  }
}

export async function down(mongoose: Mongoose) {
  logger.info(
    "[DCIT 426] Down migration: no-op (one-time migration with irreversible email/push sends)",
  );
}