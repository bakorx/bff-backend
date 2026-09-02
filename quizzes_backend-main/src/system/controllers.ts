import { Request, Response } from "express";
import * as services from "./services";
import * as selectors from "./selectors";
import { User } from "@/users";
import { Contact } from "@/contacts";
import { EmailCampaign } from "@/email";
import { sendSuccess, sendError } from "@/utils";
import { shortQueue, longQueue } from "@/schedulers";
import { getMigrationStatus } from "@/migrations/runner";
import { logger } from "@/config";

// --- SYSTEM DOMAIN CONTROLLERS ---

/**
 * Generic file upload handler.
 * Uploads to Firebase and returns the public URL.
 */
export const uploadFile = async (req: Request, res: Response) => {
  try {
    if (!req.file) return sendError(res, "No file uploaded", 400);

    const folder = (req.body?.folder ||
      req.query?.folder ||
      "others") as string;
    const uploadedBy = (req as any).user?._id;
    const uploadDoc = await services.processAndSaveUpload(
      req.file,
      folder,
      uploadedBy,
    );

    sendSuccess(res, "File uploaded successfully", uploadDoc, null, 201);
  } catch (error: any) {
    logger.error("UPLOAD ERROR", error);
    sendError(res, error.message || "Internal server error during upload", 500);
  }
};

export const joinWaitlist = async (req: Request, res: Response) => {
  try {
    const { entry, isNew } = await services.joinWaitlistSafely(req.body);
    if (!isNew) {
      return sendSuccess(
        res,
        "You are already on the waitlist. We will be in touch!",
        { email: entry.email },
        null,
        200,
      );
    }
    await shortQueue.enqueue("email:waitlist_joined", {
      email: entry.email,
      name: entry.name,
    });
    sendSuccess(res, "Successfully joined waitlist", entry, null, 201);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getWaitlist = async (req: Request, res: Response) => {
  try {
    const entries = await selectors.getAllWaitlistEntries(req.query);
    sendSuccess(res, "Waitlist retrieved successfully", entries);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getSubscribers = async (req: Request, res: Response) => {
  try {
    const entries = await selectors.getAllNewsletterSubscribers(req.query);
    sendSuccess(res, "Subscribers retrieved successfully", entries);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getWaitlistEntry = async (req: Request, res: Response) => {
  try {
    const entry = await selectors.getWaitlistEntryById(req.params.id as string);
    if (!entry) return sendError(res, "Waitlist entry not found", 404);
    sendSuccess(res, "Waitlist entry retrieved successfully", entry);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getAdminStats = async (req: Request, res: Response) => {
  try {
    const [totalUsers, totalWaitlist, totalNewsletter, totalCampaigns] =
      await Promise.all([
        User.countDocuments({ isDeleted: false }),
        Contact.countDocuments({ isWaitlist: true }),
        Contact.countDocuments({ isNewsletter: true }),
        EmailCampaign.countDocuments(),
      ]);

    sendSuccess(res, "Admin stats retrieved successfully", {
      users: totalUsers,
      waitlist: totalWaitlist,
      newsletter: totalNewsletter,
      campaigns: totalCampaigns,
    });
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

// --- NEWSLETTER CONTROLLERS ---

export const subscribeNewsletter = async (req: Request, res: Response) => {
  try {
    const { subscriber, alreadyActive } = await services.subscribeToNewsletter(
      req.body,
    );

    if (alreadyActive) {
      return sendSuccess(
        res,
        "You are already subscribed to our newsletter!",
        { email: subscriber.email },
        null,
        200,
      );
    }

    await shortQueue.enqueue("email:newsletter_confirm", {
      email: subscriber.email,
      token: subscriber.confirmationToken,
      unsubscribeToken: subscriber.unsubscribeToken,
    });

    sendSuccess(
      res,
      "Subscription initiated. Please check your email to confirm.",
      { email: subscriber.email },
      null,
      201,
    );
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const confirmNewsletter = async (req: Request, res: Response) => {
  try {
    const { token } = req.query;
    if (!token) return sendError(res, "Confirmation token is required", 400);

    const subscriber = await services.confirmNewsletterSubscription(
      token as string,
    );

    await shortQueue.enqueue("email:newsletter_welcome", {
      email: subscriber.email,
      unsubscribeToken: subscriber.unsubscribeToken,
    });

    sendSuccess(res, "Subscription confirmed successfully", {
      email: subscriber.email,
    });
  } catch (error: any) {
    sendError(res, error.message, 400);
  }
};

export const unsubscribeNewsletter = async (req: Request, res: Response) => {
  try {
    const { token } = req.query;
    if (!token) return sendError(res, "Unsubscribe token is required", 400);

    const subscriber = await services.unsubscribeFromNewsletter(
      token as string,
    );
    sendSuccess(res, "Unsubscribed successfully", { email: subscriber.email });
  } catch (error: any) {
    sendError(res, error.message, 400);
  }
};

// --- DATABASE MIGRATION CONTROLLERS ---

export const getMigrationHistory = async (req: Request, res: Response) => {
  try {
    const { page, limit, search } = req.query;
    const status = await services.getMigrationStatus({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      search: search as string,
    });
    sendSuccess(res, "Migration history retrieved successfully", status);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const runDatabaseMigrations = async (req: Request, res: Response) => {
  try {
    const adminId = (req as any).user?.id;
    const adminEmail = (req as any).user?.email;
    const rerun = req.body?.rerun === true;
    const migrationIds = Array.isArray(req.body?.migrationIds)
      ? req.body.migrationIds.filter(
          (id: unknown): id is string => typeof id === "string",
        )
      : [];

    await longQueue.enqueue("system:run_migrations", {
      adminId,
      adminEmail,
      rerun,
      migrationIds,
    });
    sendSuccess(
      res,
      migrationIds.length > 0
        ? rerun
          ? `Migration rerun job enqueued for ${migrationIds.length} script(s)`
          : `Migration job enqueued for ${migrationIds.length} pending script(s)`
        : rerun
          ? "Database migration rerun job enqueued successfully"
          : "Database migration job enqueued successfully",
    );
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const updateMigration = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const migration = await services.updateMigrationRecord(id, req.body);
    if (!migration) {
      return sendError(res, "Migration record not found", 404);
    }
    sendSuccess(res, "Migration record updated successfully", migration);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};
