import { Router } from "express";
import * as controllers from "./controllers";
import { authGuard } from "@/middlewares";

export const streakRouter = Router();

/**
 * @swagger
 * /subscriptions/streak/status:
 *   get:
 *     summary: Get the authenticated user's streak status
 *     tags: [Streak]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Current streak information
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Streak'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
streakRouter.get("/status", authGuard, controllers.getStreak);

/**
 * @swagger
 * /subscriptions/streak/freeze:
 *   post:
 *     summary: Freeze the authenticated user's streak
 *     description: Uses one freeze credit to protect the current streak from breaking.
 *     tags: [Streak]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Streak frozen successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Streak'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
streakRouter.post("/freeze", authGuard, controllers.freezeStreak);
