import { Router } from "express";
import { authGuard } from "@/middlewares";
import { validate } from "@/utils";
import * as controllers from "./controllers";
import {
  EmailCampaignSerializer,
  EmailCampaignUpdateSerializer,
  EmailCampaignImageSerializer,
} from "./serializers";

const emailCampaignRouter: Router = Router();

// --- Campaign Management ---

/**
 * @swagger
 * /email-campaigns:
 *   post:
 *     summary: Create a new email campaign
 *     description: Creates a new email campaign in draft status. Requires authentication (super-admin only).
 *     tags: [EmailCampaigns]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/EmailCampaign'
 *     responses:
 *       201:
 *         description: Campaign created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EmailCampaign'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
emailCampaignRouter.post(
  "/",
  authGuard,
  validate(EmailCampaignSerializer),
  controllers.createCampaign,
);

/**
 * @swagger
 * /email-campaigns:
 *   get:
 *     summary: List all email campaigns
 *     description: Returns a paginated list of email campaigns.
 *     tags: [EmailCampaigns]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SearchParam'
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, generating, approved, scheduled, dispatching, done, failed, cancelled]
 *         description: Filter by campaign status
 *     responses:
 *       200:
 *         description: Paginated list of campaigns
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/EmailCampaign'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
emailCampaignRouter.get("/", authGuard, controllers.getCampaigns);

/**
 * @swagger
 * /email-campaigns/images:
 *   get:
 *     summary: List all email campaign images (asset library)
 *     description: Returns a paginated, most-recent-first list of all email campaign images. Pass `campaignId` to filter to a specific campaign.
 *     tags: [EmailCampaigns]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - in: query
 *         name: campaignId
 *         schema:
 *           type: string
 *         description: Filter images by campaign ObjectId
 *     responses:
 *       200:
 *         description: Paginated list of campaign images sorted by most recent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/EmailCampaignImage'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
emailCampaignRouter.get("/images", authGuard, controllers.getAllImages);

/**
 * @swagger
 * /email-campaigns/{id}:
 *   get:
 *     summary: Get an email campaign by ID
 *     tags: [EmailCampaigns]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the campaign
 *     responses:
 *       200:
 *         description: Campaign details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EmailCampaign'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
emailCampaignRouter.get("/:id", authGuard, controllers.getCampaign);

/**
 * @swagger
 * /email-campaigns/{id}:
 *   patch:
 *     summary: Update an email campaign
 *     description: Partially updates an existing email campaign. All fields are optional.
 *     tags: [EmailCampaigns]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the campaign
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/EmailCampaign'
 *     responses:
 *       200:
 *         description: Campaign updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EmailCampaign'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
emailCampaignRouter.patch(
  "/:id",
  authGuard,
  validate(EmailCampaignUpdateSerializer),
  controllers.updateCampaign,
);

/**
 * @swagger
 * /email-campaigns/{id}/generate:
 *   post:
 *     summary: Generate AI campaign body
 *     description: Triggers AI generation of the campaign Markdown body using the stored prompt instruction and link contexts.
 *     tags: [EmailCampaigns]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the campaign
 *     responses:
 *       200:
 *         description: Campaign body generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EmailCampaign'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
emailCampaignRouter.post("/:id/generate", authGuard, controllers.generateCampaign);

/**
 * @swagger
 * /email-campaigns/{id}/approve:
 *   post:
 *     summary: Approve a campaign and queue dispatch
 *     description: Approves the campaign and enqueues it for bulk email dispatch to the target audience.
 *     tags: [EmailCampaigns]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the campaign
 *     responses:
 *       200:
 *         description: Campaign approved and dispatch queued
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EmailCampaign'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
emailCampaignRouter.post("/:id/approve", authGuard, controllers.approveCampaign);

/**
 * @swagger
 * /email-campaigns/{id}/clone:
 *   post:
 *     summary: Clone a campaign as a new draft
 *     description: Creates a copy of the campaign with a fresh draft status and zeroed stats. Safe to use on completed, failed, or cancelled campaigns.
 *     tags: [EmailCampaigns]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the campaign to clone
 *     responses:
 *       201:
 *         description: Cloned campaign in draft status
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EmailCampaign'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
emailCampaignRouter.post("/:id/clone", authGuard, controllers.cloneCampaign);

/**
 * @swagger
 * /email-campaigns/{id}/preview:
 *   post:
 *     summary: Send a test preview email
 *     description: Sends a test copy of the campaign email to the authenticated admin's address.
 *     tags: [EmailCampaigns]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the campaign
 *     responses:
 *       200:
 *         description: Test email dispatched
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 email:
 *                   type: string
 *                   format: email
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
emailCampaignRouter.post("/:id/preview", authGuard, controllers.sendPreview);

// --- Image Management ---

/**
 * @swagger
 * /email-campaigns/{id}/images:
 *   post:
 *     summary: Attach image metadata to a campaign
 *     description: Records the URL and metadata of an image associated with an email campaign.
 *     tags: [EmailCampaigns]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the campaign
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/EmailCampaignImage'
 *     responses:
 *       201:
 *         description: Image metadata saved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EmailCampaignImage'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
emailCampaignRouter.post(
  "/:id/images",
  authGuard,
  validate(EmailCampaignImageSerializer),
  controllers.captureImageMetadata,
);

/**
 * @swagger
 * /email-campaigns/{id}/images:
 *   get:
 *     summary: Get images for a campaign
 *     description: Returns all image records associated with the specified campaign.
 *     tags: [EmailCampaigns]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the campaign
 *     responses:
 *       200:
 *         description: Array of image metadata
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/EmailCampaignImage'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
emailCampaignRouter.get("/:id/images", authGuard, controllers.getCampaignImages);

export { emailCampaignRouter };
