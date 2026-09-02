import { Request, Response } from "express";
import * as services from "./services";
import * as selectors from "./selectors";
import { shortQueue, longQueue } from "@/schedulers";
import { sendSuccess, sendError, IPaginationOptions } from "@/utils";
import { User } from "@/users";
import { EmailCampaign, EmailCampaignImage } from "./models";
import { resolveLinkContext, ContactContext } from "./services";

export const createCampaign = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return sendError(res, "Unauthorized", 401);
    const campaign = await services.createCampaign({
      ...req.body,
      createdBy: req.user.id,
    });
    sendSuccess(res, "Campaign created", campaign, null, 201);
  } catch (error: any) {
    sendError(res, error.message, 400);
  }
};

export const updateCampaign = async (req: Request, res: Response) => {
  try {
    const campaign = await services.updateCampaign(
      req.params.id as string,
      req.body,
    );
    if (!campaign) return sendError(res, "Campaign not found", 404);
    sendSuccess(res, "Campaign updated", campaign);
  } catch (error: any) {
    sendError(res, error.message, 400);
  }
};

export const getCampaigns = async (req: Request, res: Response) => {
  try {
    const options: IPaginationOptions = {
      page: parseInt(req.query.page as string) || 1,
      limit: parseInt(req.query.limit as string) || 20,
      search: req.query.search as string,
      searchFields: ["title", "subjectLine"],
      ...(req.query.status ? { status: req.query.status } : {}),
    };
    const campaigns = await selectors.getAllCampaigns(options);
    sendSuccess(res, "Campaigns retrieved", campaigns);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getCampaign = async (req: Request, res: Response) => {
  try {
    const campaign = await selectors.getCampaignById(req.params.id as string);
    if (!campaign) return sendError(res, "Campaign not found", 404);
    sendSuccess(res, "Campaign retrieved", campaign);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const cloneCampaign = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return sendError(res, "Unauthorized", 401);
    const clone = await services.cloneCampaign(req.params.id as string, req.user.id);
    sendSuccess(res, "Campaign cloned", clone, null, 201);
  } catch (error: any) {
    sendError(res, error.message, 400);
  }
};

// ---------------------------------------------------------------------------
// AI Generation
// ---------------------------------------------------------------------------

export const generateCampaign = async (req: Request, res: Response) => {
  try {
    const campaignId = req.params.id;
    const campaign = await EmailCampaign.findById(campaignId);
    if (!campaign) return sendError(res, "Campaign not found", 404);
    if (campaign.status !== "draft") {
      return sendError(res, "Only draft campaigns can be re-generated", 400);
    }

    campaign.status = "generating";
    await campaign.save();

    await longQueue.enqueue("email:campaign:generate_body", { campaignId });

    sendSuccess(res, "Campaign body generation queued", campaign);
  } catch (error: any) {
    sendError(res, error.message, 400);
  }
};

// ---------------------------------------------------------------------------

export const approveCampaign = async (req: Request, res: Response) => {
  try {
    const campaign = await services.approveCampaign(req.params.id as string);
    await longQueue.enqueue("email:campaign:dispatch", {
      campaignId: campaign._id.toString(),
    });
    sendSuccess(res, "Campaign approved and dispatch queued", campaign);
  } catch (error: any) {
    sendError(res, error.message, 400);
  }
};

// ---------------------------------------------------------------------------
// Preview (Send Test)
// ---------------------------------------------------------------------------

export const sendPreview = async (req: Request, res: Response) => {
  try {
    const adminId = req.user?.id;
    if (!adminId) return sendError(res, "Unauthorized", 401);

    const [campaign, admin] = await Promise.all([
      EmailCampaign.findById(req.params.id),
      User.findById(adminId),
    ]);

    if (!campaign) return sendError(res, "Campaign not found", 404);
    if (!admin) return sendError(res, "Admin not found", 404);
    if (!campaign.bodyMarkdown)
      return sendError(res, "Campaign has no body to send", 400);

    const ctx: ContactContext = {
      contactId: admin._id.toString(),
      email: admin.email,
      unsubscribeToken: admin.authKey || "admin-test-token",
    };

    const resolvedLinks: Record<string, string> = {};
    for (const link of campaign.linkContexts) {
      resolvedLinks[link.label] = resolveLinkContext(link, ctx);
    }

    await shortQueue.enqueue("email:campaign:send_test", {
      campaignId: campaign._id.toString(),
      userId: admin._id.toString(),
      subject: `[TEST] ${campaign.subjectLine}`,
      bodyMarkdown: campaign.bodyMarkdown,
      recipient: {
        email: admin.email,
        name: admin.name || admin.username || "Admin",
        unsubscribeToken: ctx.unsubscribeToken,
      },
      links: Object.entries(resolvedLinks).map(([label, url]) => ({
        label,
        url,
      })),
      category: "newsletter",
      type: "promotional",
    });

    sendSuccess(res, "Test email sent to your admin address", {
      success: true,
      email: admin.email,
    });
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

// ---------------------------------------------------------------------------
// Image Management
// ---------------------------------------------------------------------------

export const captureImageMetadata = async (req: Request, res: Response) => {
  try {
    const { upload, altText } = req.body;
    const campaignId = req.params.id;

    if (!upload || !altText) {
      return sendError(res, "Upload ID and Alt Text are required", 400);
    }

    const image = new EmailCampaignImage({
      upload,
      altText,
      campaignId,
      createdBy: req.user?.id,
    });

    await image.save();
    sendSuccess(res, "Image metadata captured", image, null, 201);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getCampaignImages = async (req: Request, res: Response) => {
  try {
    const images = await EmailCampaignImage.find({
      campaignId: req.params.id,
    })
      .sort({ createdAt: -1 })
      .populate("upload");
    sendSuccess(res, "Campaign images retrieved", images);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getAllImages = async (req: Request, res: Response) => {
  try {
    const options: IPaginationOptions = {
      page: parseInt(req.query.page as string) || 1,
      limit: parseInt(req.query.limit as string) || 20,
      ...(req.query.campaignId ? { campaignId: req.query.campaignId } : {}),
    };
    const images = await selectors.getAllImages(options);
    sendSuccess(res, "Images retrieved", images);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};
