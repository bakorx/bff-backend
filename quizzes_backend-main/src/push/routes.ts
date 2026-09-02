import { Router } from "express";
import { authGuard, attachUser } from "@/middlewares";
import * as controllers from "./controllers";

const pushRouter = Router();

/**
 * @swagger
 * tags:
 *   name: Push
 *   description: Web Push notification subscription management
 */

/**
 * @swagger
 * /push/vapid-public-key:
 *   get:
 *     summary: Get the VAPID public key for push subscription
 *     tags: [Push]
 *     responses:
 *       200:
 *         description: VAPID public key
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 publicKey:
 *                   type: string
 */
pushRouter.get("/vapid-public-key", controllers.getVapidPublicKey);

/**
 * @swagger
 * /push/subscribe:
 *   post:
 *     summary: Subscribe a device to push notifications
 *     tags: [Push]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - endpoint
 *               - keys
 *             properties:
 *               endpoint:
 *                 type: string
 *               keys:
 *                 type: object
 *                 required:
 *                   - p256dh
 *                   - auth
 *                 properties:
 *                   p256dh:
 *                     type: string
 *                   auth:
 *                     type: string
 *     responses:
 *       201:
 *         description: Subscription registered
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deviceLabel:
 *                   type: string
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
pushRouter.post("/subscribe", attachUser, controllers.subscribeToPush);

/**
 * @swagger
 * /push/unsubscribe:
 *   delete:
 *     summary: Unsubscribe a device from push notifications
 *     tags: [Push]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - endpoint
 *             properties:
 *               endpoint:
 *                 type: string
 *     responses:
 *       200:
 *         description: Unsubscribed successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
pushRouter.delete("/unsubscribe", controllers.unsubscribeFromPush);

/**
 * @swagger
 * /push/subscriptions:
 *   get:
 *     summary: Get all push subscriptions for the authenticated user
 *     tags: [Push]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of active subscriptions
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   deviceLabel:
 *                     type: string
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *                   lastUsedAt:
 *                     type: string
 *                     format: date-time
 *                   endpoint:
 *                     type: string
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
pushRouter.get("/subscriptions", authGuard, controllers.getUserSubscriptions);

/**
 * @swagger
 * /push/test:
 *   post:
 *     summary: Send a test push notification to the authenticated user
 *     tags: [Push]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               body:
 *                 type: string
 *               url:
 *                 type: string
 *     responses:
 *       200:
 *         description: Test push notification sent
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
pushRouter.post("/test", authGuard, controllers.sendTestPush);

export { pushRouter };
