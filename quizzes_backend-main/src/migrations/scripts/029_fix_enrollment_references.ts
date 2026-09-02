import { Mongoose, Types } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 029: Fix Enrollment References and Notify Users.
 *
 * 1. Identifies and removes UserCourseEnrollment records with null courseId or
 *    courseId pointing to a non-existent course.
 * 2. Deduplicates enrollments (same user, course, semester, year).
 * 3. Notifies affected users via in-app notification and enqueues a push notification task.
 */
export async function up(mongoose: Mongoose) {
  const db = mongoose.connection.db;
  if (!db) throw new Error("[029] No db connection");

  logger.info("[029] Starting enrollment cleanup and notification sweep...");

  const enrollmentsCol = db.collection("usercourseenrollments");
  const coursesCol = db.collection("courses");
  const notificationsCol = db.collection("notifications");

  // 1. Get all enrollments and valid course IDs
  const allEnrollments = await enrollmentsCol.find({}).toArray();
  const allCourses = await coursesCol
    .find({}, { projection: { _id: 1 } })
    .toArray();
  const validCourseIds = new Set(allCourses.map((c) => c._id.toString()));

  const affectedUserIds = new Set<string>();
  const userEnrollmentKeys = new Set<string>(); // userId:courseId:semester:year

  let orphanCount = 0;
  let duplicateCount = 0;

  logger.info(`[029] Analyzing ${allEnrollments.length} enrollments...`);

  for (const enrollment of allEnrollments) {
    const enrollmentId = enrollment._id;
    const userId = enrollment.userId.toString();
    const courseId = enrollment.courseId?.toString();
    const semester = enrollment.semester;
    const year = enrollment.academicYear;

    // A. Check for orphan enrollment
    if (!courseId || !validCourseIds.has(courseId)) {
      logger.info(
        `[029] Deleting orphan enrollment ${enrollmentId} for user ${userId}`,
      );
      await enrollmentsCol.deleteOne({ _id: enrollmentId });
      affectedUserIds.add(userId);
      orphanCount++;
      continue;
    }

    // B. Check for duplicate
    const key = `${userId}:${courseId}:${semester}:${year}`;
    if (userEnrollmentKeys.has(key)) {
      logger.info(
        `[029] Deleting duplicate enrollment ${enrollmentId} for user ${userId}`,
      );
      await enrollmentsCol.deleteOne({ _id: enrollmentId });
      duplicateCount++;
      continue;
    }

    userEnrollmentKeys.add(key);
  }

  logger.info(
    `[029] Cleanup finished: ${orphanCount} orphans removed, ${duplicateCount} duplicates removed.`,
  );

  if (affectedUserIds.size === 0) {
    logger.info("[029] No users affected. Skipping notifications.");
    return;
  }

  logger.info(
    `[029] Notifying ${affectedUserIds.size} users about enrollment adjustments...`,
  );

  const notificationTitle = "Enrollment Update";
  const notificationBody =
    "Some of your course enrollments were adjusted due to a system update. Please verify your course list to ensure you receive accurate exam alerts.";

  const now = new Date();

  // 1. Create in-app notifications in bulk
  const notifications = Array.from(affectedUserIds).map((userId) => ({
    userId: new Types.ObjectId(userId),
    type: "system_update",
    isSystemNotification: true,
    channels: {
      email: true,
      inApp: true,
      push: true,
    },
    title: notificationTitle,
    body: notificationBody,
    read: false,
    createdAt: now,
    updatedAt: now,
  }));

  if (notifications.length > 0) {
    await notificationsCol.insertMany(notifications);
    logger.info(`[029] Created ${notifications.length} in-app notifications.`);
  }

  // 2. Enqueue push and email notifications via the 'notification:enrollment_update' job
  try {
    const { shortQueue } = require("../../schedulers/queues");
    for (const userId of Array.from(affectedUserIds)) {
      await shortQueue.enqueue("notification:enrollment_update", {
        userId,
      });
    }
    logger.info(
      `[029] Enqueued ${affectedUserIds.size} enrollment update notification jobs.`,
    );
  } catch (err: any) {
    logger.info(
      `[029] Could not enqueue notifications via BullMQ: ${err.message}`,
    );
    logger.info(
      "[029] In-app notifications were still created in the database.",
    );
  }

  logger.info("[029] Migration complete.");
}
