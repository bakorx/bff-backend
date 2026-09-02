import { z } from "zod";
import { ADMIN_CAMPAIGN_TYPES } from "./interfaces";

export const EmailCampaignSerializer = z
  .object({
    title: z
      .string()
      .min(3)
      .max(100)
      .describe("The internal title of the campaign"),
    subjectLine: z.string().min(3).max(150).describe("The email subject line"),
    previewText: z
      .string()
      .max(200)
      .optional()
      .describe("Teaser text shown in email clients"),
    promptInstruction: z
      .string()
      .min(10)
      .describe("Instructions for the AI to generate the body"),
    bodyMarkdown: z
      .string()
      .optional()
      .describe("The email body in Markdown format"),
    campaignType: z
      .enum(ADMIN_CAMPAIGN_TYPES)
      .default("newsletter")
      .describe("The type of email campaign"),
    audience: z
      .enum(["single", "broadcast"])
      .default("broadcast")
      .describe("Audience scope of the campaign"),
    linkContexts: z
      .array(
        z.object({
          label: z.string().describe("Display label for the link"),
          baseUrl: z.url().describe("Base URL of the link"),
          pathTemplate: z
            .string()
            .describe("Path template appended to the base URL"),
        }),
      )
      .optional()
      .describe("Dynamic links to be injected into the email"),
    audienceFilter: z
      .object({
        includeContacts: z.boolean().optional(),
        includeUsers: z.boolean().optional(),
        contactLanes: z
          .object({
            waitlist: z.boolean().optional(),
            newsletter: z.boolean().optional(),
          })
          .optional(),
        contactStatus: z
          .object({
            waitlistStatus: z.array(z.enum(["active", "removed"])).optional(),
            newsletterStatus: z
              .array(z.enum(["pending", "active", "unsubscribed", "bounced"]))
              .optional(),
          })
          .optional(),
        roles: z
          .array(z.enum(["super_admin", "creator", "moderator", "student"]))
          .optional(),
        courseIds: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/)).optional(),
        specificUserIds: z
          .array(z.string().regex(/^[0-9a-fA-F]{24}$/))
          .optional(),
        specificEmails: z.array(z.string().email()).optional(),
        excludeUnsubscribed: z.boolean().optional(),
        excludeBounced: z.boolean().optional(),
        excludeUserIds: z
          .array(z.string().regex(/^[0-9a-fA-F]{24}$/))
          .optional(),
        excludeEmails: z.array(z.string().email()).optional(),
        excludeRecentRecipientHours: z.number().optional(),
      })
      .optional()
      .describe("Audience targeting filter"),
    scheduledFor: z
      .string()
      .datetime()
      .optional()
      .describe("Scheduled send date/time"),
    images: z
      .array(
        z.object({
          url: z.url().describe("Public URL of the image"),
          altText: z
            .string()
            .min(1)
            .describe("Accessibility description for the image"),
          filename: z.string().optional().describe("Original file name"),
          mimetype: z.string().optional().describe("File MIME type"),
          size: z.number().optional().describe("File size in bytes"),
        }),
      )
      .optional()
      .describe("Associated image metadata for the email content"),
    status: z
      .enum([
        "draft",
        "approved",
        "scheduled",
        "dispatching",
        "done",
        "failed",
        "cancelled",
      ])
      .optional()
      .describe("Lifecycle status of the campaign"),
  })
  .describe("Serializer for Email Campaigns");

export const EmailCampaignUpdateSerializer =
  EmailCampaignSerializer.partial().describe(
    "Serializer for updating an Email Campaign",
  );

export const EmailCampaignImageSerializer = z
  .object({
    url: z.url().describe("The public URL of the uploaded image"),
    altText: z.string().min(1).describe("Accessibility description"),
    filename: z.string().optional().describe("Original file name"),
    mimetype: z.string().optional().describe("File MIME type"),
    size: z.number().optional().describe("File size in bytes"),
    campaignId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid campaign ID")
      .optional()
      .describe("The campaign this image belongs to"),
  })
  .describe("Serializer for Email Campaign Images");
