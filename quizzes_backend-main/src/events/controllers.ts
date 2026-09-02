import { Request, Response } from "express";
import { logger } from "@/config";
import { sendSuccess, sendError } from "@/utils";
import * as services from "./services";

/**
 * POST /api/v1/events — event collector (issue #179).
 *
 * This endpoint IS the write path, so unlike emit() calls made as a
 * side-effect of some other controller action, we await it and return the
 * result. The "fire-and-forget, never block a user-facing response" rule
 * in rec-engine.md §6 is about other controllers calling emit() as a
 * side-effect — it doesn't apply to the dedicated ingestion endpoint whose
 * entire job is writing the event.
 */
export const createEvent = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return sendError(res, "Unauthorized", 401);
    }

    const { eventType, sourceRef, payload, occurredAt } = req.body;

    const event = await services.emit(
      eventType,
      req.user.id,
      sourceRef,
      payload,
      { occurredAt },
    );

    if (!event) {
      // Dropped — either not in the §6a taxonomy allow-list, or a §6
      // backpressure failure. Both are already logged in emit(). Not a
      // client error, so don't surface one.
      return sendSuccess(res, "Event accepted", { eventId: null }, null, 202);
    }

    return sendSuccess(
      res,
      "Event recorded",
      { eventId: String(event._id), eventType: event.eventType },
      null,
      201,
    );
  } catch (error: any) {
    logger.error("[events] createEvent error:", error?.message ?? error);
    sendError(res, "Failed to record event", 500);
  }
};

/**
 * GET /api/v1/events — paginated read path (issue #180).
 * Cursor-based, NOT offset-based. See services.ts#listEventsForUser.
 */
export const listEvents = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return sendError(res, "Unauthorized", 401);
    }

    const cursor =
      typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const eventTypes =
      typeof req.query.eventTypes === "string"
        ? req.query.eventTypes.split(",").filter(Boolean)
        : undefined;

    if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
      return sendError(res, "limit must be a positive number", 400);
    }

    const page = await services.listEventsForUser(req.user.id, {
      cursor,
      limit,
      eventTypes,
    });

    sendSuccess(res, "Events retrieved", page.events, {
      nextCursor: page.nextCursor,
    });
  } catch (error: any) {
    logger.error("[events] listEvents error:", error?.message ?? error);
    sendError(res, "Failed to fetch events", 500);
  }
};
