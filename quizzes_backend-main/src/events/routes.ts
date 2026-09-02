import { Router } from "express";
import { authGuard } from "@/middlewares";
import { validate } from "@/utils";
import { CreateEventSerializer } from "./serializers";
import * as controllers from "./controllers";

const eventsRouter = Router();

/**
 * @swagger
 * tags:
 *   name: Events
 *   description: Event bus ingestion + read path (docs/rec-engine.md §6)
 */

/**
 * @swagger
 * /events:
 *   post:
 *     summary: Record an event
 *     tags: [Events]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - eventType
 *               - sourceRef
 *             properties:
 *               eventType:
 *                 type: string
 *               sourceRef:
 *                 type: object
 *                 required: [type, id]
 *                 properties:
 *                   type:
 *                     type: string
 *                   id:
 *                     type: string
 *               payload:
 *                 type: object
 *               occurredAt:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Event recorded
 *       202:
 *         description: Event accepted but dropped (backpressure) — see rec-engine.md §6
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
eventsRouter.post(
  "/",
  authGuard,
  validate(CreateEventSerializer),
  controllers.createEvent,
);

/**
 * @swagger
 * /events:
 *   get:
 *     summary: List the authenticated user's events, cursor-paginated
 *     tags: [Events]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: eventTypes
 *         schema:
 *           type: string
 *         description: Comma-separated list of event types to filter by
 *     responses:
 *       200:
 *         description: Paginated events
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
eventsRouter.get("/", authGuard, controllers.listEvents);

export { eventsRouter };
