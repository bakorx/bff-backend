import { Document, Types, Model } from "mongoose";
import { IUpload } from "@/system";

export const ADMIN_CAMPAIGN_TYPES = [
  "newsletter",
  "announcement",
  "product_update",
  "waitlist_update",
  "system_update",
  "exam_reminder",
  "quiz_available",
  "welcome",
] as const;

export const TRANSACTIONAL_CAMPAIGN_TYPES = [
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
] as const;

export type CampaignType =
  | "newsletter"
  | "announcement"
  | "product_update"
  | "waitlist_update"
  | "system_update"
  | "exam_reminder"
  | "quiz_available"
  | "welcome"
  | "password_reset"
  | "security_alert"
  | "account_activity"
  | "approval_status_change"
  | "program_offering_available"
  | "study_partner_request"
  | "email_verification"
  | "student_verification"
  | "weekly_digest"
  | "role_update"
  | "account_banned"
  | "payment_receipt"
  | "donation_thank_you"
  | "account_linked";

export type CampaignStatus =
  | "draft"
  | "generating"
  | "approved"
  | "scheduled"
  | "dispatching"
  | "done"
  | "failed"
  | "cancelled";

export type AudienceLevel = "platform" | "course" | "role" | "individual";

export type TokenExpiry =
  "transactional" | "newsletter" | "default" | "student_verify";

export interface IAudienceFilter {
  includeContacts?: boolean;
  includeUsers?: boolean;
  contactLanes?: { waitlist?: boolean; newsletter?: boolean };
  contactStatus?: {
    waitlistStatus?: ("active" | "removed")[];
    newsletterStatus?: ("pending" | "active" | "unsubscribed" | "bounced")[];
  };
  roles?: ("super_admin" | "creator" | "moderator" | "student")[];
  courseIds?: Types.ObjectId[];
  specificUserIds?: Types.ObjectId[];
  specificEmails?: string[];
  excludeUnsubscribed?: boolean;
  excludeBounced?: boolean;
  excludeUserIds?: Types.ObjectId[];
  excludeEmails?: string[];
  excludeRecentRecipientHours?: number;
}

export interface IAudiencePreview {
  estimatedCount: number;
  estimatedAt: Date;
  exactCount?: number;
  exactCountAt?: Date;
  description: string;
  level: AudienceLevel;
}

export interface IRecipientStatus {
  recipientId?: Types.ObjectId;
  email: string;
  name?: string;
  status: "pending" | "sent" | "failed" | "bounced";
  sentAt?: Date;
  failedAt?: Date;
  failureReason?: string;
  jobId?: string;
}

export interface ILinkContext {
  label: string;
  baseUrl: string;
  pathTemplate: string;
}

export interface IEmailCampaign extends Document {
  // Existing fields (kept from INewsletterCampaign)
  title: string;
  subjectLine: string;
  previewText?: string;
  promptInstruction: string;
  linkContexts: ILinkContext[];
  bodyMarkdown?: string;
  status: CampaignStatus;
  stats: {
    sent: number;
    failed: number;
    bounced: number;
    opened: number;
    clicked: number;
    unsubscribed: number;
    openRate: number;
    clickRate: number;
    bounceRate: number;
    lastUpdated?: Date;
  };
  dispatchTotal?: number;
  createdBy: Types.ObjectId;
  dispatchedAt?: Date;
  // New fields
  campaignType: CampaignType;
  audience: "single" | "broadcast";
  recipient?: IRecipientStatus;
  scheduledFor?: Date;
  sendingStartedAt?: Date;
  completedAt?: Date;
  // Context refs
  blogPostId?: Types.ObjectId;
  examEntryId?: Types.ObjectId;
  quizId?: Types.ObjectId;
  programOfferingId?: Types.ObjectId;
  // Audience targeting
  audienceFilter?: IAudienceFilter;
  audiencePreview?: IAudiencePreview;
  isSystemGenerated: boolean;
  isTest: boolean;
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface IEmailCampaignImage extends Document {
  upload: Types.ObjectId | IUpload;
  altText: string;
  campaignId?: Types.ObjectId;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface IEmailSendLog extends Document {
  campaignId: Types.ObjectId;
  recipientId?: Types.ObjectId;
  recipientType: "user" | "contact";
  email: string;

  status: "sent" | "failed" | "bounced";
  sentAt?: Date;
  failedAt?: Date;
  failureReason?: string;

  // Only written when event occurs — not pre-populated
  openedAt?: Date;
  clickedAt?: Date;
  unsubscribedAt?: Date;
  bouncedAt?: Date;

  // JWT token — carries campaignId + email + recipientId
  trackingToken: string;

  createdAt: Date;
}

export interface IEmailSendLogModel extends Model<IEmailSendLog> {
  recordEvent(
    campaignId: string,
    email: string,
    event: "open" | "click" | "unsubscribe" | "bounce",
  ): Promise<void>;
}

export interface EmailLinkTokenPayload {
  action: string;
  userId?: string;
  email?: string;
  recipientType?: "user" | "contact";
  universityId?: string;
  campusId?: string;
  collegeId?: string;
  schoolId?: string;
  departmentId?: string;
  courseId?: string;
  quizId?: string;
  campaignId?: string;
  programOfferingId?: string;
  blogPostId?: string;
  // Arbitrary — markdown strings, labels, redirect URLs, anything
  meta?: Record<string, string>;
}
