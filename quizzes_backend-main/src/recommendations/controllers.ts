import { Request, Response } from "express";
import { logger } from "@/config";
import { sendSuccess, sendError } from "@/utils";
import { User } from "@/users";
import { getRecommendationSet } from "./services";
import { ExternalResource } from "./models";

const VALID_SURFACES = [
  "quiz_end",
  "dashboard",
  "in_session",
  "session_start",
  "session_end",
  "courses",
];

/**
 * GET /api/v1/recommendations — rec-engine.md §7.1. #6.
 */
export const getRecommendations = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return sendError(res, "Unauthorized", 401);
    }

    const surface = typeof req.query.surface === "string" ? req.query.surface : "";
    if (!VALID_SURFACES.includes(surface)) {
      return sendError(
        res,
        `surface must be one of: ${VALID_SURFACES.join(", ")}`,
        400,
      );
    }

    const recSet = await getRecommendationSet(req.user.id, surface);
    sendSuccess(res, "Recommendations retrieved", recSet);
  } catch (error: any) {
    logger.error("[recommendations] getRecommendations error:", error?.message ?? error);
    sendError(res, "Failed to fetch recommendations", 500);
  }
};

/**
 * POST /api/v1/recommendations/external-resources — rec-engine.md §12
 * submission flow. #14.
 *
 * "Verified email is the only requirement" (§12 "Trust floor") — checked
 * with a targeted lookup since authGuard doesn't do a DB round-trip and
 * the JWT claims don't carry emailVerified (it can change after token
 * issuance, so it must be read fresh, not trusted from the token).
 */
export const submitExternalResource = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return sendError(res, "Unauthorized", 401);
    }

    const user = await User.findById(req.user.id).select("emailVerified").lean();
    if (!user?.emailVerified) {
      // §16: "Unverified email submission -> 403 with clear message -> User-facing error."
      return sendError(res, "Verify your email before submitting a resource", 403);
    }

    const { title, url, source, topicTags, difficulty, language, submitterOptIn } =
      req.body;

    const resource = await ExternalResource.create({
      title,
      url,
      source,
      topicTags,
      difficulty,
      language,
      status: "pending",
      submittedBy: req.user.id,
      sourceType: "community",
      ...(submitterOptIn !== undefined && { submitterOptIn }),
    });

    sendSuccess(res, "Resource submitted for review", resource, null, 201);
  } catch (error: any) {
    logger.error(
      "[recommendations] submitExternalResource error:",
      error?.message ?? error,
    );
    sendError(res, "Failed to submit resource", 500);
  }
};

// ---------------------------------------------------------------------------
// Moderation API (#17) — rec-engine.md §12 "Moderation actions" table.
// Admin-only (see routes.ts for the role gate). #16 (the admin moderation
// queue UI that would call these) is a separate frontend build item, not
// part of this repo.
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/admin/recommendations/external-resources?status=pending —
 * the read side the moderation queue UI needs; not explicitly named as its
 * own build-order item, but "Moderation API" isn't usable without a way to
 * see what's pending.
 */
export const listExternalResourcesForModeration = async (
  req: Request,
  res: Response,
) => {
  try {
    const VALID_STATUSES = ["pending", "approved", "rejected", "needs_review"] as const;
    const status =
      typeof req.query.status === "string" ? req.query.status : "pending";
    if (!VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
      return sendError(
        res,
        `status must be one of: ${VALID_STATUSES.join(", ")}`,
        400,
      );
    }

    const resources = await ExternalResource.find({
      status: status as (typeof VALID_STATUSES)[number],
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    sendSuccess(res, "Resources retrieved", resources);
  } catch (error: any) {
    logger.error(
      "[recommendations] listExternalResourcesForModeration error:",
      error?.message ?? error,
    );
    sendError(res, "Failed to fetch resources", 500);
  }
};

/**
 * PATCH /api/v1/admin/recommendations/external-resources/:id/approve —
 * covers both "Approve" (empty body) and "Edit + Approve" (§12: "Apply
 * edits to the resource, then approve") as one action, since the doc
 * describes them as the same moderation decision differing only in
 * whether edits are applied first.
 */
export const approveExternalResource = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return sendError(res, "Unauthorized", 401);
    }

    const resource = await ExternalResource.findById(req.params.id);
    if (!resource) {
      return sendError(res, "Resource not found", 404);
    }

    const { title, url, source, topicTags, difficulty, language } = req.body;
    if (title !== undefined) resource.title = title;
    if (url !== undefined) resource.url = url;
    if (source !== undefined) resource.source = source;
    if (topicTags !== undefined) resource.topicTags = topicTags;
    if (difficulty !== undefined) resource.difficulty = difficulty;
    if (language !== undefined) resource.language = language;

    resource.status = "approved";
    resource.moderatedBy = req.user.id as any;
    resource.moderatedAt = new Date();
    await resource.save();

    sendSuccess(res, "Resource approved", resource);
  } catch (error: any) {
    logger.error(
      "[recommendations] approveExternalResource error:",
      error?.message ?? error,
    );
    sendError(res, "Failed to approve resource", 500);
  }
};

/**
 * PATCH /api/v1/admin/recommendations/external-resources/:id/reject —
 * §12 "Reject": status='rejected', rejectionReason, moderatedBy, moderatedAt.
 */
export const rejectExternalResource = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return sendError(res, "Unauthorized", 401);
    }

    const resource = await ExternalResource.findById(req.params.id);
    if (!resource) {
      return sendError(res, "Resource not found", 404);
    }

    resource.status = "rejected";
    resource.rejectionReason = req.body.rejectionReason;
    resource.moderatedBy = req.user.id as any;
    resource.moderatedAt = new Date();
    await resource.save();

    sendSuccess(res, "Resource rejected", resource);
  } catch (error: any) {
    logger.error(
      "[recommendations] rejectExternalResource error:",
      error?.message ?? error,
    );
    sendError(res, "Failed to reject resource", 500);
  }
};
