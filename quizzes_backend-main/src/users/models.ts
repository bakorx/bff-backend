import { Schema, model, Model } from "mongoose";
import {
  IUser,
  IToken,
  IEmailUpdate,
  INotification,
  IScheduledNotificationJob,
} from "./interfaces";

const UserSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: true,
    },
    studentId: {
      type: String,
      trim: true,
    },
    username: {
      type: String,
      unique: true,
      required: true,
    },
    email: {
      type: String,
      unique: true,
      required: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: false,
    },
    authKey: {
      type: String,
      lowercase: true,
    },
    role: {
      type: String,
      required: true,
      enum: ["student", "creator", "moderator", "super_admin"],
      default: "student",
    },
    isBanned: {
      type: Boolean,
      default: false,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    linkedProviders: {
      type: [
        {
          provider: {
            type: String,
            enum: ["google", "github"],
            required: true,
          },
          providerUserId: { type: String, required: true },
          email: { type: String, required: true, lowercase: true },
          linkedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    accessType: {
      type: String,
      enum: ["quiz", "course", "duration", "default"],
      default: "default",
    },
    isSubscribed: {
      type: Boolean,
      default: false,
    },
    hasFreeAccess: {
      type: Boolean,
      default: true,
    },
    freeAccessCount: {
      type: Number,
      default: 2,
    },
    quizCredits: {
      type: Number,
      default: 1200,
    },
    lastLogin: {
      type: Date,
      default: Date.now,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    preferredPersonaId: {
      type: Schema.Types.ObjectId,
      required: false, // Rationale: Backward compatibility
      ref: "ChatbotPersona",
    },
    aiUsageStats: {
      totalCreditsUsed: {
        type: Number,
        default: 0,
      },
      creditsRemaining: {
        type: Number,
        default: 1200,
      },
      lastRechargeDate: {
        type: Date,
      },
      monthlyUsage: {
        type: Map,
        of: Number,
        default: {}, // Since the interface had Record<string, number>
      },
      questionsAsked: {
        type: Number,
        default: 0,
      },
      explanationsRequested: {
        type: Number,
        default: 0,
      },
    },
    enrolments: {
      type: [Schema.Types.ObjectId],
      ref: "StudentEnrolment",
      default: [],
    },
    primaryEnrolmentId: {
      type: Schema.Types.ObjectId,
      ref: "StudentEnrolment",
      required: false,
    },
    programSubscriptions: {
      type: [Schema.Types.ObjectId],
      ref: "ProgramOfferingSubscription",
      default: [],
    },
    profilePicture: {
      type: Schema.Types.ObjectId,
      ref: "Upload",
      required: false,
    },
    oauthPicture: {
      type: String,
      required: false,
    },
    yearOfStudy: { type: Number },
    bio: {
      type: String,
      maxlength: 160,
    },
    onboarding: {
      completed: { type: Boolean, default: false },
      completedAt: { type: Date },
      currentStep: { type: Number, default: 0 },
      steps: {
        profile: { type: Boolean, default: false },
        yearOfStudy: { type: Boolean, default: false },
        pushOptIn: { type: Boolean, default: false },
        zIntro: { type: Boolean, default: false },
      },
    },
    notificationSettings: {
      examReminders: {
        email: { type: Boolean, default: true },
        inApp: { type: Boolean, default: true },
        push: { type: Boolean, default: true },
        reminderIntervals: { type: [Number], default: [3, 1] },
      },
      quizAvailability: {
        email: { type: Boolean, default: true },
        inApp: { type: Boolean, default: true },
        push: { type: Boolean, default: true },
      },
      studyPartnerActivity: {
        email: { type: Boolean, default: true },
        inApp: { type: Boolean, default: true },
        push: { type: Boolean, default: true },
      },
      courseAnnouncements: {
        email: { type: Boolean, default: true },
        inApp: { type: Boolean, default: true },
        push: { type: Boolean, default: true },
      },
      recommendationUpdates: {
        email: { type: Boolean, default: true },
        inApp: { type: Boolean, default: true },
        push: { type: Boolean, default: true },
      },
      approvalStatusChanges: {
        email: { type: Boolean, default: true },
        inApp: { type: Boolean, default: true },
        push: { type: Boolean, default: true },
      },
      newsletter: {
        email: { type: Boolean, default: true },
        inApp: { type: Boolean, default: true },
        push: { type: Boolean, default: true },
      },
      securityAlerts: {
        email: { type: Boolean, default: true },
        inApp: { type: Boolean, default: true },
        push: { type: Boolean, default: true },
      },
      accountActivity: {
        email: { type: Boolean, default: true },
        inApp: { type: Boolean, default: true },
        push: { type: Boolean, default: true },
      },
      systemUpdates: {
        email: { type: Boolean, default: true },
        inApp: { type: Boolean, default: true },
        push: { type: Boolean, default: true },
      },
      weeklyDigest: { type: Boolean, default: false },
    },
    passwordChangedAt: {
      type: Date,
    },
    lastDigestSentAt: {
      type: Date,
      default: null,
    },
    // --- New monetisation fields ---
    planTier: {
      type: String,
      enum: ["cooked", "cruising", "locked_in"],
      default: null,
    },
    planDuration: {
      type: String,
      enum: ["daily", "weekly", "semester"],
      default: null,
    },
    dailyUsage: {
      date: { type: Date, default: new Date(0) },
      tutorSessions: { type: Number, default: 0 },
      quizGenerations: { type: Number, default: 0 },
      flashcardSets: { type: Number, default: 0 },
      mindMaps: { type: Number, default: 0 },
      materialUploads: { type: Number, default: 0 },
    },
    credits: {
      balance: { type: Number, default: 0 },
      lifetimeEarned: { type: Number, default: 0 },
    },
    referralCode: {
      type: String,
      unique: true,
      sparse: true,
    },
    referredBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    pendingReferralDiscount: {
      type: Boolean,
      default: false,
    },
    studentVerification: {
      status: {
        type: String,
        enum: ["none", "pending", "verified", "lapsed", "revoked"],
        default: "none",
      },
      studentEmail: { type: String, default: null, lowercase: true },
      verifiedAt: { type: Date, default: null },
      expiresAt: { type: Date, default: null },
      lastTokenSentAt: { type: Date, default: null },
      abuseFlagged: { type: Boolean, default: false },
    },
    streak: {
      currentCount: { type: Number, default: 0 },
      longestStreak: { type: Number, default: 0 },
      lastStudyDate: { type: Date, default: null },
      freezesAvailable: { type: Number, default: 0 },
      freezeUsedOnDate: { type: Date, default: null },
      restoreUsedThisTerm: { type: Boolean, default: false },
      pausedForBreak: { type: Boolean, default: false },
    },
    loyaltyDiscount: {
      permanentPercentage: { type: Number, default: 0 },
    },
  },
  {
    timestamps: true,
  },
);


UserSchema.index(
  { "studentVerification.studentEmail": 1 },
  { sparse: true, name: "idx_student_email_verification" }
);

// Index for OAuth provider lookup — finds the user a given (provider, providerUserId) is already linked to.
UserSchema.index(
  { "linkedProviders.provider": 1, "linkedProviders.providerUserId": 1 },
  { name: "idx_linked_providers" }
);

export const User: Model<IUser> = model<IUser>("User", UserSchema);

const TokenSchema = new Schema<IToken>({
  accessToken: {
    type: String,
    required: true,
  },
  refreshToken: {
    type: String,
    required: true,
  },
  date: {
    type: Date,
    default: Date.now(),
  },
  userId: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: "User",
  },
});

export const Token: Model<IToken> = model<IToken>("Token", TokenSchema);

const EmailUpdateSchema: Schema = new Schema(
  {
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: String,
      required: true,
    },
    renderedHtml: {
      type: String,
    },
    context: {
      type: String,
      trim: true,
    },
    type: {
      type: String,
      enum: ["update", "promotional", "security", "general"],
      default: "update",
    },
    links: [
      {
        label: String,
        url: String,
      },
    ],
    status: {
      type: String,
      enum: ["draft", "approved", "sent", "rejected"],
      default: "draft",
    },
    isAiGenerated: {
      type: Boolean,
      default: false,
    },
    aiContextRefs: {
      type: [String],
      default: undefined,
    },
    requestedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    approvedAt: {
      type: Date,
    },
    rejectedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    rejectedAt: {
      type: Date,
    },
    rejectionReason: {
      type: String,
      trim: true,
    },
    sentAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

export const EmailUpdate: Model<IEmailUpdate> = model<IEmailUpdate>(
  "EmailUpdate",
  EmailUpdateSchema,
);

const NotificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: [
        "exam_reminder",
        "quiz_available",
        "study_partner_request",
        "study_partner_message",
        "course_announcement",
        "recommendation_update",
        "approval_status_change",
        "newsletter",
        "security_alert",
        "account_activity",
        "system_update",
        "program_offering_available",
      ],
      required: true,
    },
    isSystemNotification: { type: Boolean, default: false },
    channels: {
      email: { type: Boolean, default: false },
      inApp: { type: Boolean, default: true },
      push: { type: Boolean, default: false },
    },
    title: { type: String, required: true },
    body: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed },
    read: { type: Boolean, default: false },
    readAt: { type: Date },
    scheduledFor: { type: Date },
    sentAt: { type: Date },
    failed: { type: Boolean, default: false },
    failureReason: { type: String },
  },
  { timestamps: true },
);
NotificationSchema.index({ userId: 1, read: 1 });
NotificationSchema.index({ userId: 1, type: 1 });
NotificationSchema.index({ scheduledFor: 1, failed: 1 });

export const Notification: Model<INotification> = model<INotification>(
  "Notification",
  NotificationSchema,
);

const ScheduledNotificationJobSchema = new Schema<IScheduledNotificationJob>(
  {
    jobType: {
      type: String,
      enum: ["exam_reminder", "quiz_available"],
      required: true,
    },
    targetUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    referenceId: { type: Schema.Types.ObjectId, required: true },
    referenceType: { type: String, enum: ["exam", "quiz"], required: true },
    scheduledFor: { type: Date, required: true },
    fired: { type: Boolean, default: false },
    firedAt: { type: Date },
    failed: { type: Boolean, default: false },
    failureReason: { type: String },
  },
  { timestamps: true },
);
ScheduledNotificationJobSchema.index({ scheduledFor: 1, fired: 1, failed: 1 });
ScheduledNotificationJobSchema.index({ targetUserId: 1 });
ScheduledNotificationJobSchema.index({ referenceId: 1, referenceType: 1 });

export const ScheduledNotificationJob: Model<IScheduledNotificationJob> =
  model<IScheduledNotificationJob>(
    "ScheduledNotificationJob",
    ScheduledNotificationJobSchema,
  );
