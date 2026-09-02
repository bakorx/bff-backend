import { Router } from "express";
import { authGuard, authorizeRoles } from "@/middlewares";
import { validate } from "@/utils";
import * as controllers from "./controllers";
import {
  SubmitExternalResourceSerializer,
  ApproveExternalResourceSerializer,
  RejectExternalResourceSerializer,
} from "./serializers";

const recommendationsRouter = Router();
const adminRecommendationsRouter = Router();

// Same role gate as other admin routers (e.g. src/learning/routes.ts).
adminRecommendationsRouter.use(authGuard, authorizeRoles("super_admin"));

/**
 * @swagger
 * tags:
 *   name: Recommendations
 *   description: rec-engine.md — tiered recommendation read path (#6)
 */

/**
 * @swagger
 * /recommendations:
 *   get:
 *     summary: Get recommendations for the authenticated user
 *     tags: [Recommendations]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: surface
 *         required: true
 *         schema:
 *           type: string
 *           enum: [quiz_end, dashboard, in_session, session_start, session_end, courses]
 *     responses:
 *       200:
 *         description: RecommendationSet
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
recommendationsRouter.get("/", authGuard, controllers.getRecommendations);

/**
 * @swagger
 * /recommendations/external-resources:
 *   post:
 *     summary: Submit a community external resource for moderation
 *     tags: [Recommendations]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, url, source, topicTags, difficulty]
 *             properties:
 *               title:
 *                 type: string
 *               url:
 *                 type: string
 *               source:
 *                 type: string
 *                 enum: [youtube, pdf, article, file]
 *               topicTags:
 *                 type: array
 *                 items:
 *                   type: string
 *               difficulty:
 *                 type: string
 *                 enum: [bece, wassce, undergrad, general]
 *               language:
 *                 type: string
 *               submitterOptIn:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Resource submitted, status=pending
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Email not verified
 */
recommendationsRouter.post(
  "/external-resources",
  authGuard,
  validate(SubmitExternalResourceSerializer),
  controllers.submitExternalResource,
);

/**
 * @swagger
 * tags:
 *   name: Recommendations (Admin)
 *   description: rec-engine.md §12 moderation actions (#17)
 */

/**
 * @swagger
 * /admin/recommendations/external-resources:
 *   get:
 *     summary: List external resources for moderation
 *     tags: [Recommendations (Admin)]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, approved, rejected, needs_review]
 *           default: pending
 *     responses:
 *       200:
 *         description: List of external resources
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
adminRecommendationsRouter.get(
  "/external-resources",
  controllers.listExternalResourcesForModeration,
);

/**
 * @swagger
 * /admin/recommendations/external-resources/{id}/approve:
 *   patch:
 *     summary: Approve an external resource, optionally editing it first
 *     tags: [Recommendations (Admin)]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               url:
 *                 type: string
 *               source:
 *                 type: string
 *                 enum: [youtube, pdf, article, file]
 *               topicTags:
 *                 type: array
 *                 items:
 *                   type: string
 *               difficulty:
 *                 type: string
 *                 enum: [bece, wassce, undergrad, general]
 *               language:
 *                 type: string
 *     responses:
 *       200:
 *         description: Resource approved
 *       404:
 *         description: Resource not found
 */
adminRecommendationsRouter.patch(
  "/external-resources/:id/approve",
  validate(ApproveExternalResourceSerializer),
  controllers.approveExternalResource,
);

/**
 * @swagger
 * /admin/recommendations/external-resources/{id}/reject:
 *   patch:
 *     summary: Reject an external resource
 *     tags: [Recommendations (Admin)]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rejectionReason]
 *             properties:
 *               rejectionReason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Resource rejected
 *       404:
 *         description: Resource not found
 */
adminRecommendationsRouter.patch(
  "/external-resources/:id/reject",
  validate(RejectExternalResourceSerializer),
  controllers.rejectExternalResource,
);

export { recommendationsRouter, adminRecommendationsRouter };
