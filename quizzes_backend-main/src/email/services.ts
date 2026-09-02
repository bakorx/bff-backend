import { Types, ClientSession } from "mongoose";
import { EmailCampaign, EmailCampaignImage } from "./models";
import {
  IEmailCampaign,
  ILinkContext,
  IEmailCampaignImage,
} from "./interfaces";
import { runInTransaction } from "@/utils";
import { STATUS_CODES } from "@/config";
import { services as aiService } from "@/ai";
import { IContact } from "@/contacts";

// ---------------------------------------------------------------------------
// Transactional subject defaults — callers should pass an explicit subject,
// but this ensures the fallback is never a raw enum string.
// ---------------------------------------------------------------------------

const TRANSACTIONAL_SUBJECTS: Partial<Record<string, string>> = {
  welcome:              "Welcome to Qz",
  role_update:          "Your Qz role has been updated",
  account_banned:       "Your Qz account has been suspended",
  password_reset:       "Reset your Qz password",
  security_alert:       "Security alert for your Qz account",
  exam_reminder:        "Upcoming exam reminder",
  student_verification: "Verify your student email",
  announcement:         "An announcement from Qz",
  system_update:        "Platform update from Qz",
  payment_receipt:      "Your Qz payment receipt",
  donation_thank_you:   "Thank you for your donation to Qz",
};

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export const createCampaign = async (data: {
  title: string;
  subjectLine: string;
  previewText?: string;
  promptInstruction: string;
  linkContexts?: ILinkContext[];
  images?: Array<Partial<IEmailCampaignImage>>;
  createdBy: string | Types.ObjectId;
  campaignType?: string;
  audience?: string;
}) => {
  return await runInTransaction(async (session) => {
    const { images, ...campaignData } = data;
    const campaign = new EmailCampaign({
      ...campaignData,
      status: "draft",
      stats: {
        sent: 0,
        failed: 0,
        bounced: 0,
        opened: 0,
        clicked: 0,
        unsubscribed: 0,
        openRate: 0,
        clickRate: 0,
        bounceRate: 0,
      },
    });
    await campaign.save({ session });

    if (images && images.length > 0) {
      const imageDocs = images.map((img) => ({
        ...img,
        campaignId: campaign._id,
        createdBy: data.createdBy,
      }));
      await EmailCampaignImage.insertMany(imageDocs, { session });
    }

    return campaign;
  });
};

/**
 * Directly sends a single transactional email by creating a campaign
 * and enqueuing it for delivery.
 */
export const sendTransactional = async (data: {
  campaignType: IEmailCampaign["campaignType"];
  recipient: {
    recipientId: Types.ObjectId | string;
    email: string;
    name?: string;
  };
  templateVariables?: Record<string, any>;
  subject?: string;
  markdownBody?: string;
}) => {
  return await runInTransaction(async (session: ClientSession) => {
    const campaign = new EmailCampaign({
      title: `Transactional: ${data.campaignType} to ${data.recipient.email}`,
      subjectLine: data.subject || TRANSACTIONAL_SUBJECTS[data.campaignType] || "Notification from Qz",
      campaignType: data.campaignType,
      audience: "single",
      recipient: {
        recipientId:
          typeof data.recipient.recipientId === "string"
            ? new Types.ObjectId(data.recipient.recipientId)
            : data.recipient.recipientId,
        email: data.recipient.email,
        name: data.recipient.name,
        status: "pending",
      },
      bodyMarkdown: data.markdownBody,
      status: "approved", // Transactional emails skip the draft/approval flow
      isSystemGenerated: true,
      createdBy: new Types.ObjectId(), // System user ID
    });

    await campaign.save({ session });
    return campaign;
  });
};

export const updateCampaign = async (
  id: string | Types.ObjectId,
  data: Partial<
    Pick<
      IEmailCampaign,
      | "title"
      | "subjectLine"
      | "previewText"
      | "promptInstruction"
      | "linkContexts"
      | "bodyMarkdown"
      | "audienceFilter"
      | "scheduledFor"
      | "campaignType"
      | "audience"
      | "recipient"
    >
  > & { images?: Array<Partial<IEmailCampaignImage>> },
) => {
  return await runInTransaction(async (session: ClientSession) => {
    const { images, ...updateData } = data;

    if (images) {
      await EmailCampaignImage.deleteMany({ campaignId: id }, { session });
      if (images.length > 0) {
        const campaign = await EmailCampaign.findById(id).session(session);
        const imageDocs = images.map((img) => ({
          ...img,
          campaignId: id,
          createdBy: campaign?.createdBy || new Types.ObjectId(),
        }));
        await EmailCampaignImage.insertMany(imageDocs, { session });
      }
    }

    return await EmailCampaign.findByIdAndUpdate(id, updateData, {
      returnDocument: "after",
      session,
    });
  });
};

// ---------------------------------------------------------------------------
// AI Generation (delegates to newsletter services.generateCampaignBody)
// ---------------------------------------------------------------------------

export const generateCampaignBody = async (id: string | Types.ObjectId) => {
  const campaign = (await EmailCampaign.findById(id)) as IEmailCampaign | null;
  if (!campaign) throw new Error("Campaign not found");
  if (campaign.status !== "draft" && campaign.status !== "generating") {
    throw new Error("Only draft or generating campaigns can be re-generated");
  }

  const linkContextBlock =
    campaign.linkContexts.length > 0
      ? `\n\n## Available Personalized Links\nYou may reference these links in your newsletter using their labels. Do NOT include the raw variables; they will be resolved automatically.\n${campaign.linkContexts
          .map((l) => `- **${l.label}**: ${l.baseUrl}${l.pathTemplate}`)
          .join("\n")}`
      : "";

  const images = await EmailCampaignImage.find({ campaignId: id }).populate(
    "upload",
  );
  const imageContextBlock =
    images.length > 0
      ? `\n\n## Visual Assets\nYou MUST include these images in the newsletter using standard Markdown image syntax ![alt text](url). These images are relevant to the content.\n${images
          .map((img) => {
            const uploadDetails = img.upload as any;
            return `- **Alt**: ${img.altText} | **URL**: ${uploadDetails?.url || ""}`;
          })
          .join("\n")}`
      : "";

  const systemPrompt = `You are Z, a professional email writer for Qz, an AI-powered university study platform built by BetaForge Labs. 
Your emails are high-quality, engaging, concise, and informative. You write in clear Markdown that renders beautifully in email clients.
Guidelines:
- Use proper Markdown headings (##), bold (**), lists, and paragraphs.
- Keep the tone professional yet warm.
- Do NOT include an email subject line — only the body.
- Do NOT add a generic salutation or closing. The email template handles those.
- Naturally reference the provided links using their labels in Markdown link syntax.`;

  const userMessage = `${campaign.promptInstruction || "Generate an engaging email based on the provided context below."}${linkContextBlock}${imageContextBlock}`;

  const result = await aiService.sendChatMessage(
    userMessage,
    [],
    { personaPrompt: systemPrompt },
    undefined,
    0,
    8_000,
  );

  return await runInTransaction(async (session: ClientSession) => {
    campaign.bodyMarkdown = result.text.trim();
    campaign.status = "draft";
    return await campaign.save({ session });
  });
};

// ---------------------------------------------------------------------------
// Clone
// ---------------------------------------------------------------------------

export const cloneCampaign = async (
  id: string | Types.ObjectId,
  createdBy: string | Types.ObjectId,
) => {
  const source = await EmailCampaign.findById(id);
  if (!source) throw new Error("Campaign not found");

  return await runInTransaction(async (session) => {
    const clone = new EmailCampaign({
      title: `${source.title} (Copy)`,
      subjectLine: source.subjectLine,
      previewText: source.previewText,
      promptInstruction: source.promptInstruction,
      linkContexts: source.linkContexts,
      bodyMarkdown: source.bodyMarkdown,
      campaignType: source.campaignType,
      audience: source.audience,
      audienceFilter: source.audienceFilter,
      blogPostId: source.blogPostId,
      examEntryId: source.examEntryId,
      quizId: source.quizId,
      programOfferingId: source.programOfferingId,
      createdBy,
      status: "draft",
      isSystemGenerated: false,
      isTest: false,
      stats: {
        sent: 0,
        failed: 0,
        bounced: 0,
        opened: 0,
        clicked: 0,
        unsubscribed: 0,
        openRate: 0,
        clickRate: 0,
        bounceRate: 0,
      },
    });

    await clone.save({ session });
    return clone;
  });
};

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

export const approveCampaign = async (id: string | Types.ObjectId) => {
  const campaign = await EmailCampaign.findById(id);
  if (!campaign) throw new Error("Campaign not found");
  if (campaign.status !== "draft")
    throw new Error("Only draft campaigns can be approved");
  if (!campaign.bodyMarkdown)
    throw new Error("Campaign must have a generated body before approval");

  return await runInTransaction(async (session: ClientSession) => {
    campaign.status = "approved";
    return await campaign.save({ session });
  });
};

// ---------------------------------------------------------------------------
// Link Context Resolver
// ---------------------------------------------------------------------------

export interface ContactContext {
  contactId: string;
  email: string;
  unsubscribeToken: string;
}

export const resolveLinkContext = (
  link: ILinkContext,
  ctx: ContactContext,
): string => {
  let path = link.pathTemplate
    .replace(/:contactId/g, encodeURIComponent(ctx.contactId))
    .replace(/:email/g, encodeURIComponent(ctx.email))
    .replace(/:unsubscribeToken/g, encodeURIComponent(ctx.unsubscribeToken));

  return `${link.baseUrl}${path}`;
};

export const buildSubscriberContext = async (
  contact: Pick<IContact, "_id" | "email" | "unsubscribeToken">,
): Promise<ContactContext> => ({
  contactId: (contact._id as Types.ObjectId).toString(),
  email: contact.email,
  unsubscribeToken: contact.unsubscribeToken,
});

export const resolveAllLinks = async (
  campaign: IEmailCampaign,
  contact: Pick<IContact, "_id" | "email" | "unsubscribeToken">,
): Promise<Record<string, string>> => {
  const ctx = await buildSubscriberContext(contact);
  const resolved: Record<string, string> = {};
  for (const link of campaign.linkContexts) {
    resolved[link.label] = resolveLinkContext(link, ctx);
  }
  return resolved;
};
