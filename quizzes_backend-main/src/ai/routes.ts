import { Router } from "express";
import {
  authGuard,
  authorizeRoles,
  authorizeSubscription,
} from "@/middlewares";
import { validate } from "@/utils";
import * as controllers from "./controllers";
import {
  AiResponseSerializer,
  AiUsageTransactionSerializer,
  ChatbotPersonaSerializer,
  StudyPartnerSessionSerializer,
} from "./serializers";

const adminRouter = Router();
const publicRouter = Router();

// Apply authentication to all admin routes
adminRouter.use(
  authGuard,
  authorizeRoles("super_admin", "creator", "moderator"),
);

// ─── Admin — Personas ──────────────────────────────────────────────────────

/**
 * @swagger
 * /admin/ai/personas:
 *   post:
 *     summary: Create a new AI chatbot persona
 *     tags: [AI]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChatbotPersona'
 *     responses:
 *       201:
 *         description: Persona created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ChatbotPersona'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
adminRouter.post(
  "/personas",
  validate(ChatbotPersonaSerializer),
  controllers.createPersona,
);

/**
 * @swagger
 * /admin/ai/personas:
 *   get:
 *     summary: List all AI personas (admin view)
 *     tags: [AI]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SortByParam'
 *       - $ref: '#/components/parameters/SortOrderParam'
 *       - $ref: '#/components/parameters/SearchParam'
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *         description: Filter by active status
 *       - in: query
 *         name: isDefault
 *         schema:
 *           type: boolean
 *         description: Filter to default personas only
 *     responses:
 *       200:
 *         description: Paginated array of persona objects
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
adminRouter.get("/personas", controllers.getAllPersonas);

/**
 * @swagger
 * /admin/ai/personas/{id}:
 *   get:
 *     summary: Get a persona by ID
 *     tags: [AI]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the persona
 *     responses:
 *       200:
 *         description: Persona object
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ChatbotPersona'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
adminRouter.get("/personas/:id", controllers.getPersona);

// ─── Admin — AI Responses ──────────────────────────────────────────────────

/**
 * @swagger
 * /admin/ai/responses:
 *   get:
 *     summary: List all AI response logs
 *     tags: [AI]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SortByParam'
 *       - $ref: '#/components/parameters/SortOrderParam'
 *       - $ref: '#/components/parameters/SearchParam'
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         description: Filter by user ObjectId
 *       - in: query
 *         name: queryType
 *         schema:
 *           type: string
 *           enum: [explanation, answer, hint, discussion, other]
 *         description: Filter by query type
 *     responses:
 *       200:
 *         description: Paginated array of AI response objects
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
adminRouter.get("/responses", controllers.getAllAiResponses);

/**
 * @swagger
 * /admin/ai/responses/{id}:
 *   get:
 *     summary: Get an AI response log by ID
 *     tags: [AI]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the AI response
 *     responses:
 *       200:
 *         description: AI response object
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AiResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
adminRouter.get("/responses/:id", controllers.getAiResponse);

// ─── Admin — AI Usage ──────────────────────────────────────────────────────

/**
 * @swagger
 * /admin/ai/usage:
 *   get:
 *     summary: List all AI usage transactions
 *     tags: [AI]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SortByParam'
 *       - $ref: '#/components/parameters/SortOrderParam'
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         description: Filter by user ObjectId
 *       - in: query
 *         name: transactionType
 *         schema:
 *           type: string
 *           enum: [debit, credit, refund]
 *         description: Filter by transaction type
 *     responses:
 *       200:
 *         description: Paginated array of AI usage transaction objects
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
adminRouter.get("/usage", controllers.getAllAiUsage);

/**
 * @swagger
 * /admin/ai/usage/{id}:
 *   get:
 *     summary: Get an AI usage transaction by ID
 *     tags: [AI]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the transaction
 *     responses:
 *       200:
 *         description: AI usage transaction object
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AiUsageTransaction'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
adminRouter.get("/usage/:id", controllers.getAiUsage);

// ─── Public — Personas ─────────────────────────────────────────────────────

/**
 * @swagger
 * /ai/personas:
 *   get:
 *     summary: Get available AI personas for the authenticated user
 *     tags: [AI]
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
 *         description: Paginated array of persona objects the user can select
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.get("/personas", authGuard, controllers.getPersonas);

// ─── Public — Study Sessions ───────────────────────────────────────────────

// ─── Public — AI Responses & Usage ────────────────────────────────────────

/**
 * @swagger
 * /ai/responses:
 *   post:
 *     summary: Save an AI response log
 *     description: Records an AI query and its response. Requires `personal:ai` subscription.
 *     tags: [AI]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AiResponse'
 *     responses:
 *       201:
 *         description: AI response saved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AiResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.post(
  "/responses",
  authGuard,
  authorizeSubscription("personal:ai"),
  validate(AiResponseSerializer),
  controllers.saveAiResponse,
);

/**
 * @swagger
 * /ai/usage:
 *   post:
 *     summary: Record an AI credit usage transaction
 *     description: Logs a debit, credit or refund against a user's AI credit balance. Requires `personal:ai` subscription.
 *     tags: [AI]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AiUsageTransaction'
 *     responses:
 *       201:
 *         description: Usage transaction recorded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AiUsageTransaction'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.post(
  "/usage",
  authGuard,
  authorizeSubscription("personal:ai"),
  validate(AiUsageTransactionSerializer),
  controllers.recordAiUsage,
);

// ─── Public — Chat ─────────────────────────────────────────────────────────

/**
 * @swagger
 * /ai/chat:
 *   post:
 *     summary: Send a one-shot AI chat message
 *     description: >
 *       Sends a message to the AI without a persistent session context.
 *       Requires an active subscription with the `personal:ai` permission.
 *       Credits are deducted per message.
 *     tags: [AI]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChatRequest'
 *     responses:
 *       200:
 *         description: AI reply with credit usage summary
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ChatResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.post(
  "/chat",
  authGuard,
  authorizeSubscription("personal:ai"),
  controllers.sendChatMessage,
);

/**
 * @swagger
 * /ai/chat/sessions/{sessionId}/message:
 *   post:
 *     summary: Send a contextual message within a study session
 *     description: >
 *       Appends a message to an existing study partner session and receives
 *       a context-aware AI reply. Requires an active subscription with the `personal:ai` permission.
 *     tags: [AI]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the study session
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChatRequest'
 *     responses:
 *       200:
 *         description: AI reply with updated session context
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ChatResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.post(
  "/chat/sessions/:sessionId/message",
  authGuard,
  authorizeSubscription("personal:ai"),
  controllers.sendSessionChatMessage,
);

export { adminRouter, publicRouter };
