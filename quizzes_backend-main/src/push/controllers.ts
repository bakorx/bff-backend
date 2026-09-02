import { Request, Response } from "express";
import { CONFIG, logger } from "@/config";
import * as services from "./services";
import { shortQueue } from "@/schedulers";
import { sendSuccess, sendError } from "@/utils";

/**
 * Get VAPID public key for push subscription
 */
export const getVapidPublicKey = async (_req: Request, res: Response) => {
  try {
    sendSuccess(res, "VAPID public key retrieved", {
      publicKey: CONFIG.VAPID.PUBLIC_KEY,
    });
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

/**
 * Subscribe a device to push notifications
 */
export const subscribeToPush = async (req: Request, res: Response) => {
  try {
    const { endpoint, keys } = req.body as {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    };

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return sendError(
        res,
        "endpoint and keys (p256dh, auth) are required",
        400,
      );
    }

    const userAgent = req.headers["user-agent"];
    const userId = req.user?.id ?? null;

    const subscription = await services.subscribe(
      userId,
      { endpoint, keys },
      userAgent,
    );

    sendSuccess(
      res,
      "Subscription registered",
      {
        deviceLabel: subscription.deviceLabel,
        createdAt: subscription.createdAt,
      },
      null,
      201,
    );
  } catch (error: any) {
    logger.error("[push] subscribe error:", error?.message ?? error);
    sendError(res, "Failed to register push subscription", 500);
  }
};

/**
 * Unsubscribe a device from push notifications
 */
export const unsubscribeFromPush = async (req: Request, res: Response) => {
  try {
    const { endpoint } = req.body as { endpoint: string };

    if (!endpoint) {
      return sendError(res, "endpoint is required", 400);
    }

    await services.unsubscribe(endpoint);
    sendSuccess(res, "Unsubscribed successfully");
  } catch (error: any) {
    logger.error("[push] unsubscribe error:", error?.message ?? error);
    sendError(res, "Failed to unsubscribe", 500);
  }
};

/**
 * Get all push subscriptions for the authenticated user
 */
export const getUserSubscriptions = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return sendError(res, "Unauthorized", 401);
    }

    const subscriptions = await services.getUserSubscriptions(req.user.id);
    sendSuccess(res, "Subscriptions retrieved", subscriptions);
  } catch (error: any) {
    logger.error("[push] getUserSubscriptions error:", error?.message ?? error);
    sendError(res, "Failed to fetch subscriptions", 500);
  }
};

/**
 * Send a test push notification to the authenticated user
 */
export const sendTestPush = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return sendError(res, "Unauthorized", 401);
    }

    const { title, body, url } = req.body as {
      title?: string;
      body?: string;
      url?: string;
    };

    await shortQueue.enqueue(
      "push:test",
      {
        userId: req.user.id,
        title,
        body,
        url,
      },
      2,
    );

    sendSuccess(res, "Test push notification job enqueued");
  } catch (error: any) {
    logger.error("[push] test push error:", error?.message ?? error);
    sendError(res, "Failed to enqueue test push notification", 500);
  }
};
