import { Types } from "mongoose";
import { EmailCampaign, EmailCampaignImage } from "./models";
import { TRANSACTIONAL_CAMPAIGN_TYPES, type CampaignStatus } from "./interfaces";
import { applySearchFilters, IPaginationOptions } from "@/utils";

const ADMIN_CAMPAIGN_FILTER = {
  isSystemGenerated: { $ne: true },
  campaignType: { $nin: [...TRANSACTIONAL_CAMPAIGN_TYPES] },
};

export const getCampaignById = async (id: string | Types.ObjectId) => {
  const campaign = await EmailCampaign.findOne({
    _id: id,
    ...ADMIN_CAMPAIGN_FILTER,
  }).lean();
  if (campaign) {
    (campaign as any).images = await EmailCampaignImage.find({
      campaignId: id,
    })
      .populate("upload")
      .lean();
  }
  return campaign;
};

export const getAllCampaigns = (options?: IPaginationOptions) =>
  applySearchFilters(EmailCampaign.find(ADMIN_CAMPAIGN_FILTER).lean(), {
    sortBy: "createdAt",
    sortOrder: "desc",
    ...options,
  });

export const getCampaignsByStatus = (
  status: CampaignStatus,
  options?: IPaginationOptions,
) =>
  applySearchFilters(
    EmailCampaign.find({ ...ADMIN_CAMPAIGN_FILTER, status }).lean(),
    {
      sortBy: "createdAt",
      sortOrder: "desc",
      ...options,
    },
  );

export const getCampaignsByCreator = (
  createdBy: string | Types.ObjectId,
  options?: IPaginationOptions,
) =>
  applySearchFilters(
    EmailCampaign.find({ ...ADMIN_CAMPAIGN_FILTER, createdBy }).lean(),
    {
      sortBy: "createdAt",
      sortOrder: "desc",
      ...options,
    },
  );

export const getAllImages = (options?: IPaginationOptions) =>
  applySearchFilters(EmailCampaignImage.find().populate("upload").lean(), {
    sortBy: "createdAt",
    sortOrder: "desc",
    ...options,
  });
