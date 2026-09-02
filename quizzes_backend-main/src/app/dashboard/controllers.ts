import { Request, Response } from "express";
import { logger } from "@/config";
import { sendSuccess, sendError } from "@/utils";
import { getDashboardForUser } from "./services";

/** GET /app/dashboard — aggregated, cached dashboard payload for the /app page. */
export const getDashboard = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return sendError(res, "Unauthorized", 401);
    const { payload, fromCache } = await getDashboardForUser(req.user.id);
    return sendSuccess(res, "Dashboard retrieved", payload, { fromCache });
  } catch (error: unknown) {
    logger.error(
      "[Dashboard] getDashboard error:",
      error instanceof Error ? error.message : error,
    );
    return sendError(res, "Failed to load dashboard", 500);
  }
};
