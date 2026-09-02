import { Router } from "express";
import * as controllers from "./controllers";
import { authGuard } from "@/middlewares";

export const studentVerifyRouter = Router();

/**
 * @swagger
 * /subscriptions/student-verify/initiate:
 *   post:
 *     summary: Initiate student email verification
 *     description: Sends a verification email to the authenticated user's institutional email address.
 *     tags: [StudentVerify]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email, description: Student institutional email address }
 *     responses:
 *       200:
 *         description: Verification email sent
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
studentVerifyRouter.post(
  "/initiate",
  authGuard,
  controllers.initiateVerification,
);

/**
 * @swagger
 * /subscriptions/student-verify/confirm:
 *   get:
 *     summary: Confirm student verification
 *     description: Public endpoint — confirms the verification token sent by email. The token is passed as a query parameter.
 *     tags: [StudentVerify]
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema: { type: string }
 *         description: Verification token from the confirmation email
 *     responses:
 *       200:
 *         description: Verification confirmed
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
studentVerifyRouter.get("/confirm", controllers.confirmVerification); // public — token in query

/**
 * @swagger
 * /subscriptions/student-verify/status:
 *   get:
 *     summary: Get student verification status
 *     tags: [StudentVerify]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Current verification status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 verified: { type: boolean }
 *                 email: { type: string, format: email }
 *                 verifiedAt: { type: string, format: date-time }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
studentVerifyRouter.get(
  "/status",
  authGuard,
  controllers.getVerificationStatus,
);
