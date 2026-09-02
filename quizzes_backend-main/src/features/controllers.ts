import { Request, Response } from "express";
import { sendSuccess, sendError } from "@/utils";
import * as services from "./services";
import * as selectors from "./selectors";
import { logger } from "@/config";

const getAdminId = (req: Request): string => {
  const id = (req as { user?: { id?: string } }).user?.id;
  if (!id) throw new Error("Missing admin id on request");
  return id;
};

export const listFlags = async (_req: Request, res: Response) => {
  try {
    const flags = await selectors.getAllFlags();
    sendSuccess(res, "Feature flags retrieved", flags);
  } catch (error: any) {
    logger.error("[features] listFlags failed", error);
    sendError(res, error.message, 500);
  }
};

export const getFlag = async (req: Request, res: Response) => {
  try {
    const flag = await selectors.getFlagByKey(req.params.key as string);
    if (!flag) return sendError(res, "Feature flag not found", 404);
    sendSuccess(res, "Feature flag retrieved", flag);
  } catch (error: any) {
    logger.error("[features] getFlag failed", error);
    sendError(res, error.message, 500);
  }
};

export const createFlag = async (req: Request, res: Response) => {
  try {
    const adminId = getAdminId(req);
    const created = await services.createFlag(req.body, adminId);
    sendSuccess(res, "Feature flag created", created, null, 201);
  } catch (error: any) {
    logger.error("[features] createFlag failed", error);
    sendError(res, error.message, 400);
  }
};

export const updateFlag = async (req: Request, res: Response) => {
  try {
    const adminId = getAdminId(req);
    const updated = await services.updateFlag(
      req.params.key as string,
      req.body,
      adminId,
    );
    sendSuccess(res, "Feature flag updated", updated);
  } catch (error: any) {
    logger.error("[features] updateFlag failed", error);
    sendError(res, error.message, 400);
  }
};

export const deleteFlag = async (req: Request, res: Response) => {
  try {
    const adminId = getAdminId(req);
    const reason =
      typeof req.body?.reason === "string" ? req.body.reason : undefined;
    await services.deleteFlag(req.params.key as string, adminId, reason);
    sendSuccess(res, "Feature flag deleted", { key: req.params.key });
  } catch (error: any) {
    logger.error("[features] deleteFlag failed", error);
    sendError(res, error.message, 400);
  }
};

export const getFlagAudit = async (req: Request, res: Response) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const history = await services.getAuditForFlag(req.params.key as string, {
      page,
      limit,
    });
    sendSuccess(res, "Audit history retrieved", history);
  } catch (error: any) {
    logger.error("[features] getFlagAudit failed", error);
    sendError(res, error.message, 500);
  }
};
