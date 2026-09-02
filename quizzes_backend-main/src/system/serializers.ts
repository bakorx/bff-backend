import { z } from "zod";

export const WaitlistSerializer = z
  .object({
    name: z
      .string()
      .min(1, "Name is required")
      .describe("Full name of interested party"),
    email: z.email("Invalid email address").describe("Contact address"),
    isDeleted: z.boolean().default(false).describe("Soft delete marker"),
  })
  .describe("Serializer for Marketing Waitlist");

export const NewsletterSubscriberSerializer = z
  .object({
    email: z.email("Invalid email address").describe("Contact address"),
    source: z
      .enum(["landing_hero", "landing_cta", "in_app", "manual", "import"])
      .default("landing_hero")
      .describe("Where the subscription came from"),
  })
  .describe("Serializer for Newsletter Subscription");

export const CourseSerializer = z
  .object({
    code: z
      .string()
      .min(1, "Course code is required")
      .describe("Unique course code"),
    title: z.string().optional().describe("Full title of the course"),
    about: z
      .string()
      .min(1, "About is required")
      .describe("Description of the course"),
    numberOfLectures: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Total number of structured lectures"),
    approvedQuestionsCount: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Current cache of approved questions"),
    semester: z.number().int().min(1).describe("Semester offered"),
    creditHours: z
      .number()
      .int()
      .min(0)
      .default(3)
      .describe("Academic credit hours"),
    year: z
      .number()
      .int()
      .default(new Date().getFullYear())
      .describe("The academic year"),
    isDeleted: z.boolean().default(false).describe("Soft delete marker"),
    createdBy: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid user ID")
      .describe("The ID of the staff member who created this"),
    schoolId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid school ID")
      .optional()
      .describe("Reference to the parent school"),
    campusId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid campus ID")
      .describe("Reference to the parent campus"),
    isShared: z
      .boolean()
      .default(false)
      .describe("Whether this course is shared externally"),
    sharedAcrossSchools: z
      .boolean()
      .default(false)
      .optional()
      .describe("Shared across all schools logic"),
    tags: z.array(z.string()).optional().describe("Search metadata tags"),
  })
  .describe("Serializer for Course model");

export const CourseEnrollmentSerializer = z
  .object({
    userId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid user ID")
      .describe("Student or academic member ID"),
    courseId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid course ID")
      .describe("The course they are enrolled in"),
    role: z
      .enum(["student", "ta", "instructor"])
      .describe("Their role in the specific course"),
    status: z
      .enum(["active", "dropped", "completed"])
      .default("active")
      .describe("Current enrollment state"),
  })
  .describe("Serializer for Course Enrolment relations");
