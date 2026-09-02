import { Schema, Model, model, Types } from "mongoose";
import {
  IEmailCampaign,
  IEmailCampaignImage,
  IEmailSendLog,
  IEmailSendLogModel,
} from "./interfaces";

const LinkContextSchema = new Schema(
  {
    label: { type: String, required: true, trim: true },
    baseUrl: { type: String, required: true, trim: true },
    pathTemplate: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const RecipientStatusSchema = new Schema(
  {
    recipientId: { type: Schema.Types.ObjectId },
    email: { type: String },
    name: { type: String },
    status: {
      type: String,
      enum: ["pending", "sent", "failed", "bounced"],
      default: "pending",
    },
    sentAt: { type: Date },
    failedAt: { type: Date },
    failureReason: { type: String },
    jobId: { type: String },
  },
  { _id: false },
);

const AudienceFilterSchema = new Schema(
  {
    // Platform level
    includeContacts: { type: Boolean, default: true },
    includeUsers: { type: Boolean, default: true },

    // Contact lane filters
    contactLanes: {
      waitlist: { type: Boolean },
      newsletter: { type: Boolean },
    },

    // Contact status filters
    contactStatus: {
      waitlistStatus: [{ type: String, enum: ["active", "removed"] }],
      newsletterStatus: [
        {
          type: String,
          enum: ["pending", "active", "unsubscribed", "bounced"],
        },
      ],
    },

    // Role filter
    roles: [
      {
        type: String,
        enum: ["super_admin", "creator", "moderator", "student"],
      },
    ],

    // Course filter
    courseIds: [{ type: Schema.Types.ObjectId, ref: "Course" }],

    // Individual overrides
    specificUserIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
    specificEmails: [{ type: String, trim: true, lowercase: true }],

    // Exclusions
    excludeUnsubscribed: { type: Boolean, default: true },
    excludeBounced: { type: Boolean, default: true },
    excludeUserIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
    excludeEmails: [{ type: String }],
    excludeRecentRecipientHours: { type: Number },
  },
  { _id: false },
);

const AudiencePreviewSchema = new Schema(
  {
    estimatedCount: { type: Number },
    estimatedAt: { type: Date },
    exactCount: { type: Number },
    exactCountAt: { type: Date },
    description: { type: String },
    level: {
      type: String,
      enum: ["platform", "course", "role", "individual"],
    },
  },
  { _id: false },
);

const EmailCampaignSchema: Schema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    subjectLine: { type: String, required: true, trim: true },
    previewText: { type: String, trim: true },
    promptInstruction: { type: String },
    linkContexts: { type: [LinkContextSchema], default: [] },
    bodyMarkdown: { type: String },
    status: {
      type: String,
      enum: [
        "draft",
        "generating",
        "approved",
        "scheduled",
        "dispatching",
        "done",
        "failed",
        "cancelled",
      ],
      default: "draft",
    },
    campaignType: {
      type: String,
      enum: [
        "newsletter",
        "announcement",
        "product_update",
        "waitlist_update",
        "system_update",
        "exam_reminder",
        "quiz_available",
        "welcome",
        "password_reset",
        "security_alert",
        "account_activity",
        "approval_status_change",
        "program_offering_available",
        "study_partner_request",
        "email_verification",
        "student_verification",
        "weekly_digest",
        "role_update",
        "account_banned",
        "payment_receipt",
        "donation_thank_you",
        "account_linked",
      ],
      default: "newsletter",
    },
    audience: {
      type: String,
      enum: ["single", "broadcast"],
      default: "broadcast",
    },
    recipient: { type: RecipientStatusSchema },
    scheduledFor: { type: Date },
    sendingStartedAt: { type: Date },
    completedAt: { type: Date },
    // Context refs
    blogPostId: { type: Schema.Types.ObjectId, ref: "BlogPost" },
    examEntryId: { type: Schema.Types.ObjectId, ref: "ExamTimetable" },
    quizId: { type: Schema.Types.ObjectId, ref: "Quiz" },
    programOfferingId: { type: Schema.Types.ObjectId, ref: "ProgramOffering" },
    stats: {
      sent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      bounced: { type: Number, default: 0 },
      opened: { type: Number, default: 0 },
      clicked: { type: Number, default: 0 },
      unsubscribed: { type: Number, default: 0 },
      openRate: { type: Number, default: 0 },
      clickRate: { type: Number, default: 0 },
      bounceRate: { type: Number, default: 0 },
      lastUpdated: { type: Date },
    },
    dispatchTotal: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    dispatchedAt: { type: Date },
    audienceFilter: { type: AudienceFilterSchema },
    audiencePreview: { type: AudiencePreviewSchema },
    isSystemGenerated: { type: Boolean, default: false },
    isTest: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Indexes
EmailCampaignSchema.index({ status: 1 });
EmailCampaignSchema.index({ createdAt: -1 });
EmailCampaignSchema.index({ campaignType: 1, status: 1 });
EmailCampaignSchema.index({ audience: 1, status: 1 });
EmailCampaignSchema.index({ scheduledFor: 1, status: 1 });
EmailCampaignSchema.index({ blogPostId: 1 });
EmailCampaignSchema.index({ "audienceFilter.roles": 1, status: 1 });

const EmailCampaignImageSchema = new Schema<IEmailCampaignImage>(
  {
    upload: { type: Schema.Types.ObjectId, ref: "Upload", required: true },
    altText: { type: String, required: true },
    campaignId: { type: Schema.Types.ObjectId, ref: "EmailCampaign" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

EmailCampaignImageSchema.index({ createdAt: -1 });
EmailCampaignImageSchema.index({ campaignId: 1, createdAt: -1 });

export const EmailCampaign: Model<IEmailCampaign> = model<IEmailCampaign>(
  "EmailCampaign",
  EmailCampaignSchema,
);

export const EmailCampaignImage: Model<IEmailCampaignImage> =
  model<IEmailCampaignImage>("EmailCampaignImage", EmailCampaignImageSchema);

const EmailSendLogSchema = new Schema<IEmailSendLog>(
  {
    campaignId: {
      type: Schema.Types.ObjectId,
      ref: "EmailCampaign",
      required: true,
    },
    recipientId: { type: Schema.Types.ObjectId },
    recipientType: { type: String, enum: ["user", "contact"], required: true },
    email: { type: String, required: true, lowercase: true, trim: true },

    status: {
      type: String,
      enum: ["sent", "failed", "bounced"],
      required: true,
    },
    sentAt: { type: Date },
    failedAt: { type: Date },
    failureReason: { type: String },

    openedAt: { type: Date },
    clickedAt: { type: Date },
    unsubscribedAt: { type: Date },
    bouncedAt: { type: Date },

    trackingToken: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Indexes
EmailSendLogSchema.index({ campaignId: 1, email: 1 }, { unique: true });
EmailSendLogSchema.index({ campaignId: 1, status: 1 });
EmailSendLogSchema.index({ email: 1, sentAt: -1 });
EmailSendLogSchema.index({ campaignId: 1, openedAt: 1 });
EmailSendLogSchema.index({ sentAt: -1 });

EmailSendLogSchema.statics.recordEvent = async function (
  campaignId: string,
  email: string,
  event: "open" | "click" | "unsubscribe" | "bounce",
): Promise<void> {
  const now = new Date();

  const eventFieldMap: Record<string, string> = {
    open: "openedAt",
    click: "clickedAt",
    unsubscribe: "unsubscribedAt",
    bounce: "bouncedAt",
  };

  const statFieldMap: Record<string, string> = {
    open: "stats.opened",
    click: "stats.clicked",
    unsubscribe: "stats.unsubscribed",
    bounce: "stats.bounced",
  };

  const eventField = eventFieldMap[event];
  const statField = statFieldMap[event];

  // Use bulkWrite — one atomic operation
  await Promise.all([
    // 1. Set event timestamp on IEmailSendLog (only if not already set)
    (EmailSendLog as IEmailSendLogModel).bulkWrite([
      {
        updateOne: {
          filter: {
            campaignId: new Types.ObjectId(campaignId),
            email: email.toLowerCase(),
            [eventField]: { $exists: false },
          },
          update: { $set: { [eventField]: now } },
        },
      },
    ]),
    // 2. $inc matching counter on IEmailCampaign.stats, recompute rates, set lastUpdated
    EmailCampaign.bulkWrite([
      {
        updateOne: {
          filter: { _id: new Types.ObjectId(campaignId) },
          update: [
            {
              $set: {
                [statField]: { $add: [`$${statField}`, 1] },
                "stats.lastUpdated": now,
              },
            },
            {
              $set: {
                "stats.openRate": {
                  $cond: [
                    { $gt: ["$stats.sent", 0] },
                    {
                      $multiply: [
                        { $divide: ["$stats.opened", "$stats.sent"] },
                        100,
                      ],
                    },
                    0,
                  ],
                },
                "stats.clickRate": {
                  $cond: [
                    { $gt: ["$stats.sent", 0] },
                    {
                      $multiply: [
                        { $divide: ["$stats.clicked", "$stats.sent"] },
                        100,
                      ],
                    },
                    0,
                  ],
                },
                "stats.bounceRate": {
                  $cond: [
                    { $gt: ["$stats.sent", 0] },
                    {
                      $multiply: [
                        { $divide: ["$stats.bounced", "$stats.sent"] },
                        100,
                      ],
                    },
                    0,
                  ],
                },
              },
            },
          ],
        },
      },
    ]),
  ]);
};

export const EmailSendLog = model<IEmailSendLog, IEmailSendLogModel>(
  "EmailSendLog",
  EmailSendLogSchema,
);
