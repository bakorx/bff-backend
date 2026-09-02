import { z } from "zod";

export const NotificationChannelsSerializer = z.object({
  email: z.boolean().default(true),
  inApp: z.boolean().default(true),
  push: z.boolean().default(true),
});

export const NotificationSettingsSerializer = z.object({
  examReminders: NotificationChannelsSerializer.extend({
    reminderIntervals: z.array(z.enum(["7", "3", "1"])).default(["7", "3", "1"]),
  }),
  quizAvailability: NotificationChannelsSerializer,
  studyPartnerActivity: NotificationChannelsSerializer,
  courseAnnouncements: NotificationChannelsSerializer,
  recommendationUpdates: NotificationChannelsSerializer,
  approvalStatusChanges: NotificationChannelsSerializer,
  newsletter: NotificationChannelsSerializer,
  securityAlerts: NotificationChannelsSerializer,
  accountActivity: NotificationChannelsSerializer,
  systemUpdates: NotificationChannelsSerializer,
  weeklyDigest: z
    .boolean()
    .default(false)
    .describe("Opt-in to the weekly study digest email"),
});

export const NotificationSettingsUpdateSerializer = NotificationSettingsSerializer.partial().describe(
  "Partial-update payload for an authenticated user's notification settings. Shape matches the GET response (flat, no `notificationSettings` wrapper).",
);

export const UserSerializer = z
  .object({
    name: z.string().describe("The full name of the user"),
    username: z
      .string()
      .min(1, "Username is required")
      .describe("The unique username"),
    email: z
      .email("Invalid email address")
      .describe("The user's email address"),
    password: z
      .string()
      .min(6, "Password must be at least 6 characters long")
      .describe("The hashed password"),
    authKey: z.string().optional().describe("Authentication key for sessions"),
    role: z
      .enum(["student", "creator", "moderator", "super_admin"])
      .default("student")
      .describe("The user's role in the system"),
    studentId: z.string().optional().describe("Student ID or Index Number"),
    isBanned: z.boolean().default(false).describe("Whether the user is banned"),
    accessType: z
      .enum(["quiz", "course", "duration", "default"])
      .default("default")
      .describe("Access tier type"),
    isSubscribed: z
      .boolean()
      .default(false)
      .describe("Whether they have an active subscription"),
    hasFreeAccess: z
      .boolean()
      .default(true)
      .describe("Whether free tier is enabled"),
    freeAccessCount: z
      .number()
      .int()
      .min(0)
      .default(2)
      .describe("Number of free accesses left"),
    quizCredits: z
      .number()
      .int()
      .min(0)
      .default(1200)
      .describe("Current AI/Quiz credits"),
    lastLogin: z.date().optional().describe("Timestamp of last login"),
    isDeleted: z.boolean().default(false).describe("Soft delete flag"),
    preferredPersonaId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid persona ID")
      .optional()
      .describe("Their preferred AI Persona"),
    bio: z
      .string()
      .max(160, "Bio must be 160 characters or less")
      .optional()
      .describe("User biography"),
    onboarding: z
      .object({
        completed: z.boolean(),
        completedAt: z.date().optional(),
        currentStep: z.number(),
        steps: z.object({
          profile: z.boolean(),
          yearOfStudy: z.boolean(),
          pushOptIn: z.boolean(),
          zIntro: z.boolean(),
        }),
      })
      .describe("Onboarding status and progress"),
    notificationSettings: NotificationSettingsSerializer.optional(),
  })
  .describe("Serializer for the User model");

export const UserUpdateSerializer = UserSerializer.partial().describe(
  "Serializer for updating the User model",
);

export const ProfileUpdateSerializer = z
  .object({
    username: z.string().min(1, "Username is required").optional(),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters long")
      .optional(),
    currentPassword: z.string().min(1, "Current password is required"),
    profilePicture: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid upload ID")
      .optional(),
    studentId: z.string().optional(),
    bio: z.string().max(160, "Bio must be 160 characters or less").optional(),
    notificationSettings: NotificationSettingsSerializer.partial().optional(),
  })
  .describe("Serializer for updating own profile");

export const ProfileCheckSerializer = z
  .object({
    username: z.string().optional(),
    email: z.email("Invalid email address").optional(),
    currentPassword: z.string().optional(),
  })
  .describe("Serializer for checking profile field validity");

export const TokenSerializer = z
  .object({
    accessToken: z.string().describe("The JWT access token"),
    refreshToken: z.string().describe("The JWT refresh token"),
    userId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid user ID")
      .describe("The user this token belongs to"),
  })
  .describe("Serializer for authentication tokens");

export const EmailUpdateSerializer = z
  .object({
    subject: z
      .string()
      .min(1, "Subject is required")
      .describe("The email subject"),
    content: z
      .string()
      .min(1, "Content is required")
      .describe("The HTML/Text content"),
    context: z.string().optional().describe("Brief context about this email"),
    type: z
      .enum(["update", "promotional", "security", "general"])
      .default("update")
      .describe("The category of the email"),
    links: z
      .array(
        z.object({
          label: z.string().describe("Link text"),
          url: z.url().describe("Link destination"),
        }),
      )
      .optional()
      .describe("Action links included in the email"),
    status: z
      .enum(["draft", "approved", "sent"])
      .default("draft")
      .describe("The status of this email broadcast"),
    sentAt: z.date().optional().describe("When it was dispatched"),
  })
  .describe("Serializer for Email Updates");
