import { Router } from "express";
import {
  authGuard,
  authorizeRoles,
  authorizeInstitution,
} from "@/middlewares";
import { systemUpload } from "@/config";
import { validate } from "@/utils";
import * as controllers from "./controllers";
import {
  WaitlistSerializer,
  NewsletterSubscriberSerializer,
} from "./serializers";

const adminRouter = Router();
const publicRouter = Router();

// Apply authentication to all admin routes
adminRouter.use(
  authGuard,
  authorizeRoles("super_admin", "creator", "moderator"),
  authorizeInstitution(),
);

// ─── Admin Routes ──────────────────────────────────────────────────────────

/**
 * @swagger
 * /admin/system/waitlist:
 *   get:
 *     summary: List all waitlist entries
 *     tags: [System]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SortByParam'
 *       - $ref: '#/components/parameters/SortOrderParam'
 *       - $ref: '#/components/parameters/SearchParam'
 *       - in: query
 *         name: university
 *         schema:
 *           type: string
 *         description: Filter by university name
 *     responses:
 *       200:
 *         description: Paginated array of waitlist entries
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
adminRouter.get("/waitlist", controllers.getWaitlist);

/**
 * @swagger
 * /admin/system/subscribers:
 *   get:
 *     summary: List all newsletter subscribers
 *     tags: [System]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SortByParam'
 *       - $ref: '#/components/parameters/SortOrderParam'
 *       - $ref: '#/components/parameters/SearchParam'
 *     responses:
 *       200:
 *         description: Paginated array of newsletter subscribers
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
adminRouter.get("/subscribers", controllers.getSubscribers);

/**
 * @swagger
 * /admin/system/stats:
 *   get:
 *     summary: Get administrative statistics
 *     description: Returns a summary of total users, waitlist entries, newsletter subscribers, and campaigns.
 *     tags: [System]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Object containing sum counts of various entities
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: number
 *                 waitlist:
 *                   type: number
 *                 newsletter:
 *                   type: number
 *                 campaigns:
 *                   type: number
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
adminRouter.get("/stats", controllers.getAdminStats);

/**
 * @swagger
 * /admin/system/migrations:
 *   get:
 *     summary: List database migrations
 *     description: Returns a list of all executed and pending database migrations.
 *     tags: [System]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Object containing executed and pending migration arrays
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
adminRouter.get("/migrations", controllers.getMigrationHistory);

/**
 * @swagger
 * /admin/system/migrations:
 *   post:
 *     summary: Run pending database migrations
 *     description: Enqueues a background job to execute any migrations that have not yet been run.
 *     tags: [System]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       202:
 *         description: Migration job enqueued successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
adminRouter.post("/migrations", controllers.runDatabaseMigrations);
adminRouter.patch("/migrations/:id", controllers.updateMigration);

/**
 * @swagger
 * /admin/system/waitlist/{id}:
 *   get:
 *     summary: Get a waitlist entry by ID
 *     tags: [System]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the waitlist entry
 *     responses:
 *       200:
 *         description: Waitlist entry object
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WaitlistEntry'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
adminRouter.get("/waitlist/:id", controllers.getWaitlistEntry);

// ─── Public Routes ─────────────────────────────────────────────────────────

/**
 * @swagger
 * /system/waitlist:
 *   post:
 *     summary: Join the platform waitlist
 *     description: Registers interest in the platform before general availability.
 *     tags: [System]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WaitlistEntry'
 *     responses:
 *       201:
 *         description: Successfully joined the waitlist
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WaitlistEntry'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.post(
  "/waitlist",
  validate(WaitlistSerializer),
  controllers.joinWaitlist,
);

// ─── Newsletter Routes ───────────────────────────────────────────────────

/**
 * @swagger
 * /system/newsletter/subscribe:
 *   post:
 *     summary: Subscribe to the platform newsletter
 *     tags: [System]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NewsletterSubscriber'
 *     responses:
 *       201:
 *         description: Subscription initiated — confirmation email sent to the provided address
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Subscription initiated. Please check your email to confirm.
 *                 email:
 *                   type: string
 *                   format: email
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.post(
  "/newsletter/subscribe",
  validate(NewsletterSubscriberSerializer),
  controllers.subscribeNewsletter,
);

/**
 * @swagger
 * /system/newsletter/confirm:
 *   get:
 *     summary: Confirm newsletter subscription
 *     description: Activates the pending newsletter subscription associated with the provided token.
 *     tags: [System]
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Confirmation token sent to the subscriber's email
 *     responses:
 *       200:
 *         description: Subscription confirmed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Subscription confirmed successfully
 *                 email:
 *                   type: string
 *                   format: email
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.get("/newsletter/confirm", controllers.confirmNewsletter);

/**
 * @swagger
 * /system/upload:
 *   post:
 *     summary: Centralized file upload endpoint
 *     description: >
 *       Uploads a file to Firebase Storage. Returns the public URL and metadata.
 *       Authenticated users only.
 *     tags: [System]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               folder:
 *                 type: string
 *                 description: Destination folder in storage (e.g. materials, newsletter, avatars)
 *     responses:
 *       201:
 *         description: File uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url:
 *                   type: string
 *                 filename:
 *                   type: string
 *                 mimetype:
 *                   type: string
 *                 size:
 *                   type: number
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.post(
  "/upload",
  authGuard,
  systemUpload.single("file"),
  controllers.uploadFile,
);

/**
 * @swagger
 * /system/newsletter/unsubscribe:
 *   get:
 *     summary: Unsubscribe from the platform newsletter
 *     description: Unsubscribes the email address associated with the provided token. The token is included in all newsletter emails as a one-click unsubscribe link.
 *     tags: [System]
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Unsubscribe token included in newsletter emails
 *     responses:
 *       200:
 *         description: Successfully unsubscribed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Unsubscribed successfully
 *                 email:
 *                   type: string
 *                   format: email
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.get("/newsletter/unsubscribe", controllers.unsubscribeNewsletter);

export { adminRouter, publicRouter };
