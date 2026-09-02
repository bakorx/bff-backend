import { Mongoose } from "mongoose";
import { logger } from "@/config";

export async function up(mongoose: Mongoose) {
  logger.info("Normalizing unbounded arrays into relation collections...");

  const db = mongoose.connection.db;
  if (!db) {
    logger.info(
      "Could not access MongoDB native db object. Ensure connection is active.",
    );
    return;
  }

  // Collections
  const usersCollection = db.collection("users");
  const coursesCollection = db.collection("courses");
  const campusesCollection = db.collection("campuses");
  const courseEnrollmentsCollection = db.collection("courseenrollments");
  const subscriptionsCollection = db.collection("subscriptions");
  const collegesCollection = db.collection("colleges");

  // 1. Migrate user.courses / user.packages / user.payments
  logger.info("Migrating User unbound arrays...");
  const usersCursor = usersCollection.find({});
  for await (const user of usersCursor) {
    // Process User Courses -> CourseEnrollments
    if (
      user.courses &&
      Array.isArray(user.courses) &&
      user.courses.length > 0
    ) {
      const enrollments = user.courses.map((courseId: any) => ({
        userId: user._id,
        courseId,
        role: "student",
        enrolledAt: new Date(),
        status: "active",
      }));
      await courseEnrollmentsCollection.insertMany(enrollments);
    }

    // Process User Packages -> Subscriptions
    if (
      user.packageId &&
      Array.isArray(user.packageId) &&
      user.packageId.length > 0
    ) {
      // Assume active if exists, though this is rudimentary
      const subscriptions = user.packageId.map((pkgId: any, index: number) => {
        const paymentId =
          user.paymentId &&
          Array.isArray(user.paymentId) &&
          user.paymentId.length > index
            ? user.paymentId[index]
            : undefined;

        return {
          userId: user._id,
          packageId: pkgId,
          paymentId: paymentId,
          status: "active",
          startDate: new Date(),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Default 30 days projection
        };
      });
      await subscriptionsCollection.insertMany(subscriptions);
    }

    // Unset the old arrays to free up document space
    await usersCollection.updateOne(
      { _id: user._id },
      {
        $unset: {
          courses: "",
          packageId: "",
          paymentId: "",
          studyPartnerSessions: "",
        },
      },
    );
  }

  // 2. Migrate courses.students
  logger.info("Migrating Courses unbound arrays...");
  const coursesCursor = coursesCollection.find({});
  for await (const course of coursesCursor) {
    if (
      course.students &&
      Array.isArray(course.students) &&
      course.students.length > 0
    ) {
      // NOTE: Using bulk update on enrollments to avoid duplicate key or re-inserting if user logic already handled it
      for (const studentId of course.students) {
        const exists = await courseEnrollmentsCollection.findOne({
          userId: studentId,
          courseId: course._id,
        });
        if (!exists) {
          await courseEnrollmentsCollection.insertOne({
            userId: studentId,
            courseId: course._id,
            role: "student",
            enrolledAt: new Date(),
            status: "active",
          });
        }
      }
    }
    await coursesCollection.updateOne(
      { _id: course._id },
      { $unset: { students: "", sharedWith: "", sharedWithSchools: "" } },
    );
  }

  // 3. Migrate campuses.colleges (setting denormalized references on colleges)
  logger.info("Migrating Campuses unbound arrays...");
  const campusesCursor = campusesCollection.find({});
  for await (const campus of campusesCursor) {
    if (
      campus.colleges &&
      Array.isArray(campus.colleges) &&
      campus.colleges.length > 0
    ) {
      await collegesCollection.updateMany(
        { _id: { $in: campus.colleges } },
        { $set: { campusId: campus._id } },
      );
    }

    if (campus.students && Array.isArray(campus.students)) {
      // Typically handled by enrollments or department mappings depending on exact domain logic.
      // We'll just unset it to comply with new schema bounds
    }

    await campusesCollection.updateOne(
      { _id: campus._id },
      { $unset: { colleges: "", students: "" } },
    );
  }

  logger.info("Normalization complete!");
}
