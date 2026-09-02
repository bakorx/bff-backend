import { Router } from "express";
import {
  authGuard,
  authenticateUser,
  authorizeRoles,
  authorizeSubscription,
  enforceUsageLimit,
} from "@/middlewares";
import { validate } from "@/utils";
import { z } from "zod";
import * as controllers from "./controllers";
import * as dashboardControllers from "./dashboard/controllers";
import * as timetableControllers from "./timetable/controllers";
import {
  StudySessionSerializer,
  SteerSessionSerializer,
  CreateMaterialSerializer,
  GenerateAIContentSerializer,
  GradeQuizSerializer,
  CreateTaskSerializer,
  UpdateTaskSerializer,
} from "./serializers";

export const publicRouter = Router();
export const adminRouter = Router();

adminRouter.use(
  authGuard,
  authorizeRoles("super_admin", "creator", "moderator"),
);

/**
 * @swagger
 * /app:
 *   post:
 *     summary: Create a study session
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               courseId: { type: string }
 *               mode: { type: string, enum: [free, structured] }
 *               planningMode: { type: string, enum: [planning, fast] }
 *     responses:
 *       201: { description: Session created }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
publicRouter.post(
  "/",
  authenticateUser,
  validate(StudySessionSerializer),
  enforceUsageLimit("tutorSessions"),
  controllers.createSession,
);

/**
 * @swagger
 * /app/materials:
 *   post:
 *     summary: Upload a new material
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file: { type: string, format: binary }
 *               title: { type: string }
 *               type: { type: string, enum: [pdf, doc, slides, text, img, link, data] }
 *     responses:
 *       201:
 *         description: Material created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AppMaterial'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.post(
  "/materials",
  authenticateUser,
  validate(CreateMaterialSerializer),
  enforceUsageLimit("materialUploads"),
  controllers.createMaterial,
);

/**
 * @swagger
 * /app/materials:
 *   get:
 *     summary: List all materials for the current user
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200:
 *         description: Paginated list of materials
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/AppMaterial'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
publicRouter.get("/materials", authGuard, controllers.getMaterials);

/**
 * @swagger
 * /app/{id}/materials/{materialId}/download:
 *   get:
 *     summary: Download a material file
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Session ObjectId
 *       - in: path
 *         name: materialId
 *         required: true
 *         schema: { type: string }
 *         description: Material ObjectId
 *     responses:
 *       200:
 *         description: File download stream
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.get("/:id/materials/:materialId/download", authGuard, controllers.downloadMaterial);

/**
 * @swagger
 * /app/materials/{id}:
 *   delete:
 *     summary: Delete a material
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Material ObjectId
 *     responses:
 *       200:
 *         description: Material deleted
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.delete("/materials/:id", authGuard, controllers.deleteMaterial);

/**
 * @swagger
 * /app/materials/{id}/process:
 *   post:
 *     summary: Trigger AI processing of a material
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Material ObjectId
 *     responses:
 *       202:
 *         description: Processing job queued
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.post("/materials/:id/process", authGuard, controllers.processMaterial);

/**
 * @swagger
 * /app/flashcards/generate:
 *   post:
 *     summary: Generate a flashcard set from a material
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GenerateAIContent'
 *     responses:
 *       202:
 *         description: Flashcard generation job queued
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
publicRouter.post(
  "/flashcards/generate",
  authenticateUser,
  validate(GenerateAIContentSerializer),
  enforceUsageLimit("flashcardSets"),
  controllers.generateFlashcards,
);

/**
 * @swagger
 * /app/quizzes/generate:
 *   post:
 *     summary: Generate a quiz from a material
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GenerateAIContent'
 *     responses:
 *       202:
 *         description: Quiz generation job queued
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
publicRouter.post(
  "/quizzes/generate",
  authenticateUser,
  validate(GenerateAIContentSerializer),
  enforceUsageLimit("quizGenerations"),
  controllers.generatePersonalQuiz,
);

/**
 * @swagger
 * /app/mindmaps/generate:
 *   post:
 *     summary: Generate a mind map autonomously from material
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GenerateAIContent'
 *     responses:
 *       202: { description: Mind Map generation job queued }
 */
publicRouter.post(
  "/mindmaps/generate",
  authenticateUser,
  validate(GenerateAIContentSerializer),
  enforceUsageLimit("mindMaps"),
  controllers.generateMindMap,
);

/**
 * @swagger
 * /app:
 *   get:
 *     summary: Get all sessions for the current user
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SortByParam'
 *       - $ref: '#/components/parameters/SortOrderParam'
 *     responses:
 *       200: { description: List of sessions }
 */
publicRouter.get("/", authGuard, controllers.getSessions);

/**
 * @swagger
 * /app/dashboard:
 *   get:
 *     summary: Get the aggregated dashboard payload for the current user
 *     description: >
 *       Returns courses with exam-based progress, today's brief activity
 *       summary, the next upcoming exam, and recent study sessions.
 *       Cached per user with a 1 hour TTL; meta.fromCache indicates a cache hit.
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200: { description: Dashboard payload }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
publicRouter.get("/dashboard", authGuard, dashboardControllers.getDashboard);

/**
 * @swagger
 * /app/timetable:
 *   get:
 *     summary: Get the aggregated timetable payload for the current user
 *     description: >
 *       Returns courses with exam schedules, daily week day rail, time-grid events,
 *       today's up-next event, weekly study workload metrics, and live task list.
 *       Cached per user+semester+academicYear+date with a 1 hour TTL.
 *     tags: [Timetable]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: semester
 *         schema: { type: string }
 *       - in: query
 *         name: academicYear
 *         schema: { type: string }
 *       - in: query
 *         name: date
 *         schema: { type: string }
 *     responses:
 *       200: { description: Timetable overview payload }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
publicRouter.get("/timetable", authGuard, timetableControllers.getTimetableOverview);

/**
 * @swagger
 * /app/{id}/join:
 *   post:
 *     summary: Join an existing session (peer collaboration)
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Session ObjectId
 *     responses:
 *       200:
 *         description: Joined session successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.post("/:id/join", authGuard, controllers.joinSession);

/**
 * @swagger
 * /app/{id}/materials:
 *   get:
 *     summary: List materials attached to a session
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of session materials
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/AppMaterial'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.get("/:id/materials", authGuard, controllers.getSessionMaterials);

/**
 * @swagger
 * /app/{id}/materials:
 *   post:
 *     summary: Attach an existing material to a session
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [materialId]
 *             properties:
 *               materialId: { type: string }
 *     responses:
 *       200:
 *         description: Material attached
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.post("/:id/materials", authGuard, controllers.addAppMaterial);

/**
 * @swagger
 * /app/{id}/materials/{materialId}:
 *   delete:
 *     summary: Remove a material from a session
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: materialId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Material removed from session
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.delete("/:id/materials/:materialId", authGuard, controllers.removeAppMaterial);

/**
 * @swagger
 * /app/{id}/highlights:
 *   post:
 *     summary: Add a highlight to a session message
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [messageId, text]
 *             properties:
 *               messageId: { type: string }
 *               text: { type: string }
 *               color: { type: string }
 *     responses:
 *       201:
 *         description: Highlight added
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.post("/:id/highlights", authGuard, controllers.addHighlight);

/**
 * @swagger
 * /app/{id}/highlights/{highlightId}:
 *   patch:
 *     summary: Update a highlight
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: highlightId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               text: { type: string }
 *               color: { type: string }
 *     responses:
 *       200:
 *         description: Highlight updated
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.patch("/:id/highlights/:highlightId", authGuard, controllers.updateHighlight);

/**
 * @swagger
 * /app/{id}/highlights/{highlightId}:
 *   delete:
 *     summary: Delete a highlight
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: highlightId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Highlight deleted
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.delete("/:id/highlights/:highlightId", authGuard, controllers.removeHighlight);

/**
 * @swagger
 * /app/memory:
 *   get:
 *     summary: Get student memory
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: courseId
 *         schema: { type: string }
 *     responses:
 *       200: { description: Student memory }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
publicRouter.get("/memory", authGuard, controllers.getMemory);

/**
 * @swagger
 * /app/flashcards:
 *   get:
 *     summary: List all flashcard sets for the current user
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200:
 *         description: List of flashcard sets
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/FlashcardSet'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
publicRouter.get("/flashcards", authGuard, controllers.getFlashcards);

/**
 * @swagger
 * /app/flashcards/{flashcardId}:
 *   get:
 *     summary: Get a specific flashcard set
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: flashcardId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Flashcard set
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/FlashcardSet'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.get(
  "/flashcards/:flashcardId",
  authGuard,
  controllers.getFlashcardSet,
);

/**
 * @swagger
 * /app/flashcards/{flashcardId}:
 *   delete:
 *     summary: Delete a flashcard set
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: flashcardId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Flashcard set deleted
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.delete(
  "/flashcards/:flashcardId",
  authGuard,
  controllers.deleteFlashcardSet,
);

/**
 * @swagger
 * /app/flashcards/{flashcardId}/cards:
 *   post:
 *     summary: Add a card to a flashcard set
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: flashcardId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [front, back]
 *             properties:
 *               front: { type: string }
 *               back: { type: string }
 *               difficulty: { type: string, enum: [easy, medium, hard] }
 *     responses:
 *       201:
 *         description: Card added
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.post(
  "/flashcards/:flashcardId/cards",
  authGuard,
  controllers.addFlashcardCard,
);

/**
 * @swagger
 * /app/flashcards/{flashcardId}/cards/{cardId}:
 *   patch:
 *     summary: Update a card in a flashcard set
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: flashcardId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: cardId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               front: { type: string }
 *               back: { type: string }
 *               difficulty: { type: string, enum: [easy, medium, hard] }
 *     responses:
 *       200:
 *         description: Card updated
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.patch(
  "/flashcards/:flashcardId/cards/:cardId",
  authGuard,
  controllers.updateFlashcardCard,
);

/**
 * @swagger
 * /app/flashcards/{flashcardId}/cards/{cardId}:
 *   delete:
 *     summary: Delete a card from a flashcard set
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: flashcardId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: cardId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Card deleted
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.delete(
  "/flashcards/:flashcardId/cards/:cardId",
  authGuard,
  controllers.deleteFlashcardCard,
);

/**
 * @swagger
 * /app/quizzes:
 *   get:
 *     summary: List all quizzes for the current user
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200:
 *         description: List of quizzes
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/AppQuiz'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
publicRouter.get("/quizzes", authGuard, controllers.getQuizzes);

/**
 * @swagger
 * /app/quizzes/grade-results/{jobId}:
 *   get:
 *     summary: Poll the result of a quiz grading job
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema: { type: string }
 *         description: Job ID returned when grading was initiated
 *     responses:
 *       200:
 *         description: Grading result (may be pending if job is still running)
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.get("/quizzes/grade-results/:jobId", authGuard, controllers.getGradeResult);

/**
 * @swagger
 * /app/quizzes/{quizId}:
 *   get:
 *     summary: Get a specific quiz
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: quizId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Quiz object
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AppQuiz'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.get("/quizzes/:quizId", authGuard, controllers.getQuiz);

/**
 * @swagger
 * /app/quizzes/{quizId}:
 *   delete:
 *     summary: Delete a quiz
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: quizId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Quiz deleted
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.delete("/quizzes/:quizId", authGuard, controllers.deleteQuiz);

/**
 * @swagger
 * /app/quizzes/{quizId}/grade:
 *   post:
 *     summary: Submit quiz answers for grading
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: quizId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [answers]
 *             properties:
 *               answers:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     questionId: { type: string }
 *                     answer: { type: string }
 *     responses:
 *       202:
 *         description: Grading job queued — poll /grade-results/{jobId} for result
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.post("/quizzes/:quizId/grade", authGuard, authorizeSubscription("personal:quizzes"), validate(GradeQuizSerializer), controllers.gradeQuizAnswers);

/**
 * @swagger
 * /app/mindmaps:
 *   get:
 *     summary: List all mind maps for the current user
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200:
 *         description: List of mind maps
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/MindMap'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
publicRouter.get("/mindmaps", authGuard, controllers.getMindMaps);

/**
 * @swagger
 * /app/mindmaps/{mindMapId}:
 *   get:
 *     summary: Get a specific mind map
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mindMapId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Mind map object
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MindMap'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.get("/mindmaps/:mindMapId", authGuard, controllers.getMindMap);

/**
 * @swagger
 * /app/mindmaps/{mindMapId}:
 *   delete:
 *     summary: Delete a mind map
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mindMapId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Mind map deleted
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.delete(
  "/mindmaps/:mindMapId",
  authGuard,
  controllers.deleteMindMap,
);

/**
 * @swagger
 * /app/{id}/mindmaps/export:
 *   post:
 *     summary: Export the session mind map
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Session ObjectId
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               format: { type: string, enum: [png, svg, json], default: json }
 *     responses:
 *       200:
 *         description: Exported mind map data or file
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.post(
  "/:id/mindmaps/export",
  authGuard,
  controllers.exportSessionMindMap,
);

/**
 * @swagger
 * /app/notes:
 *   get:
 *     summary: List all notes for the current user
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200:
 *         description: List of notes
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/AppNote'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
publicRouter.get("/notes", authGuard, controllers.getNotes);

/**
 * @swagger
 * /app/notes/{noteId}:
 *   get:
 *     summary: Get a specific note
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: noteId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Note object
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AppNote'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.get("/notes/:noteId", authGuard, controllers.getNote);

/**
 * @swagger
 * /app/notes/{sessionId}/{noteId}:
 *   delete:
 *     summary: Delete a note from a session
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: noteId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Note deleted
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.delete(
  "/notes/:sessionId/:noteId",
  authGuard,
  controllers.deleteNote,
);

// ─── Studio Routes ──────────────────────────────────────────────────────────

/**
 * @swagger
 * /app/{id}/studio/notes:
 *   post:
 *     summary: Create a note in the studio
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Session ObjectId
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, content]
 *             properties:
 *               title: { type: string }
 *               content: { type: string }
 *     responses:
 *       201:
 *         description: Note created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AppNote'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.post("/:id/studio/notes", authGuard, controllers.createStudioNote);

/**
 * @swagger
 * /app/{id}/studio/notes/{noteId}:
 *   patch:
 *     summary: Update a studio note
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: noteId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               content: { type: string }
 *     responses:
 *       200:
 *         description: Note updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AppNote'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.patch("/:id/studio/notes/:noteId", authGuard, controllers.updateStudioNote);

/**
 * @swagger
 * /app/{id}/studio/notes/{noteId}:
 *   delete:
 *     summary: Delete a studio note
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: noteId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Note deleted
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.delete("/:id/studio/notes/:noteId", authGuard, controllers.deleteStudioNote);

/**
 * @swagger
 * /app/{id}/studio/shared-notes:
 *   post:
 *     summary: Create a shared note in the studio
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Session ObjectId
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, content]
 *             properties:
 *               title: { type: string }
 *               content: { type: string }
 *     responses:
 *       201:
 *         description: Shared note created
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.post("/:id/studio/shared-notes", authGuard, controllers.createStudioSharedNote);

/**
 * @swagger
 * /app/{id}/studio/flashcards/save:
 *   post:
 *     summary: Save studio-generated flashcards
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Session ObjectId
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [flashcards]
 *             properties:
 *               flashcards:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     front: { type: string }
 *                     back: { type: string }
 *     responses:
 *       201:
 *         description: Flashcards saved
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.post(
  "/:id/studio/flashcards/save",
  authenticateUser,
  enforceUsageLimit("flashcardSets"),
  controllers.saveStudioFlashcards,
);

/**
 * @swagger
 * /app/{id}/studio/quizzes/{quizId}/save:
 *   post:
 *     summary: Save a studio-generated quiz
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Session ObjectId
 *       - in: path
 *         name: quizId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       201:
 *         description: Quiz saved
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.post(
  "/:id/studio/quizzes/:quizId/save",
  authenticateUser,
  enforceUsageLimit("quizGenerations"),
  controllers.saveStudioQuiz,
);

/**
 * @swagger
 * /app/{id}/studio/exports:
 *   post:
 *     summary: Create a studio export (e.g. PDF, slides)
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Session ObjectId
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [format]
 *             properties:
 *               format: { type: string, enum: [pdf, slides, md] }
 *               content: { type: string }
 *     responses:
 *       202:
 *         description: Export job queued
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.post("/:id/studio/exports", authGuard, controllers.createStudioExport);

/**
 * @swagger
 * /app/{id}/studio/mindmap:
 *   patch:
 *     summary: Update the studio mind map for a session
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Session ObjectId
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nodes: { type: array, items: { type: object } }
 *               edges: { type: array, items: { type: object } }
 *     responses:
 *       200:
 *         description: Mind map updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MindMap'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.patch("/:id/studio/mindmap", authGuard, controllers.updateStudioMindMap);

/**
 * @swagger
 * /app/tasks:
 *   post:
 *     summary: Create a task
 *     tags: [Tasks]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       201: { description: Task created }
 *   get:
 *     summary: List the current user's tasks, with progress metadata
 *     tags: [Tasks]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, completed] }
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200: { description: "{ tasks, metadata: { completed, total, progress } }" }
 */
publicRouter.post(
  "/tasks",
  authGuard,
  validate(CreateTaskSerializer),
  controllers.createTask,
);
publicRouter.get("/tasks", authGuard, controllers.listTasks);

/**
 * @swagger
 * /app/tasks/{id}:
 *   patch:
 *     summary: Update a task (edit title/subject, or toggle status)
 *     tags: [Tasks]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Task updated }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   delete:
 *     summary: Delete a task
 *     tags: [Tasks]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Task deleted }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
publicRouter.patch(
  "/tasks/:id",
  authGuard,
  validate(UpdateTaskSerializer),
  controllers.updateTask,
);
publicRouter.delete("/tasks/:id", authGuard, controllers.deleteTask);

/**
 * @swagger
 * /app/{id}:
 *   get:
 *     summary: Get a specific session
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Session details }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
publicRouter.get("/:id", authGuard, controllers.getSession);

/**
 * @swagger
 * /app/{id}:
 *   delete:
 *     summary: Delete (abandon) a session
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Session deleted }
 */
publicRouter.delete("/:id", authGuard, controllers.deleteSession);

/**
 * @swagger
 * /app/{id}/start:
 *   post:
 *     summary: Start a session (Z begins processing)
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       202: { description: Session starting }
 */
publicRouter.post("/:id/start", authGuard, controllers.startSession);

/**
 * @swagger
 * /app/{id}/message:
 *   post:
 *     summary: Send a message to Z
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message: { type: string, minLength: 1 }
 *     responses:
 *       202: { description: Message queued }
 */
publicRouter.post(
  "/:id/message",
  authGuard,
  validate(
    z.object({
      message: z.string().min(1),
      messageId: z.string().optional(),
      isSystemAction: z.boolean().optional(),
      type: z.enum(["text", "system_action"]).optional(),
    }),
  ),
  controllers.sendMessage,
);

/**
 * @swagger
 * /app/{id}/message/{messageId}/retry:
 *   post:
 *     summary: Retry a failed message
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Session ObjectId
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema: { type: string }
 *         description: Message ObjectId to retry
 *     responses:
 *       202:
 *         description: Message retry queued
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.post(
  "/:id/message/:messageId/retry",
  authGuard,
  controllers.retryMessage,
);

/**
 * @swagger
 * /app/{id}/messages/{messageId}/rate:
 *   post:
 *     summary: Rate a message (thumbs up/down)
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Session ObjectId
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema: { type: string }
 *         description: Message ObjectId to rate
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rating]
 *             properties:
 *               rating: { type: integer, enum: [1, -1], description: "1 = positive, -1 = negative" }
 *     responses:
 *       200:
 *         description: Rating recorded
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
publicRouter.post(
  "/:id/messages/:messageId/rate",
  authGuard,
  validate(z.object({ rating: z.union([z.literal(1), z.literal(-1)]) })),
  controllers.rateMessage,
);

/**
 * @swagger
 * /app/analytics/summary:
 *   get:
 *     summary: Get aggregated study analytics for the current user
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Analytics summary
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AnalyticsSummary'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
publicRouter.get("/analytics/summary", authGuard, controllers.getAnalytics);

/**
 * @swagger
 * /app/{id}/approve:
 *   post:
 *     summary: Approve the study plan
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       202: { description: Plan approved }
 */
publicRouter.post("/:id/approve", authGuard, controllers.approvePlan);

publicRouter.post("/:id/continue", authGuard, controllers.continueJourney);

publicRouter.patch(
  "/:id/artifacts/:artifactId/respond",
  authGuard,
  controllers.respondToDirectiveArtifact,
);

publicRouter.post(
  "/:id/study-plan/generate",
  authGuard,
  controllers.generateStudyPlan,
);

publicRouter.post(
  "/:id/course-summary/generate",
  authGuard,
  controllers.generateCourseSummary,
);

publicRouter.post(
  "/:id/study-plan/chapters",
  authGuard,
  controllers.addChapter,
);

publicRouter.patch(
  "/:id/study-plan/chapters/:chapterId",
  authGuard,
  controllers.updateChapter,
);

publicRouter.post(
  "/:id/study-plan/chapters/:chapterId/goals",
  authGuard,
  controllers.addChapterGoal,
);

publicRouter.patch(
  "/:id/study-plan/chapters/:chapterId/goals/:goalId",
  authGuard,
  controllers.updateChapterGoal,
);

publicRouter.delete(
  "/:id/study-plan/chapters/:chapterId/goals/:goalId",
  authGuard,
  controllers.deleteChapterGoal,
);

publicRouter.patch(
  "/:id/study-plan/blocks/:blockId/toggle",
  authGuard,
  controllers.toggleBlockCompletion,
);

/**
 * @swagger
 * /app/{id}/steer:
 *   post:
 *     summary: Send a steering instruction to Z
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [instruction]
 *             properties:
 *               instruction: { type: string, minLength: 1 }
 *     responses:
 *       202: { description: Steering instruction received }
 */
publicRouter.post(
  "/:id/steer",
  authGuard,
  validate(SteerSessionSerializer),
  controllers.steerSession,
);

/**
 * @swagger
 * /app/{id}/resume:
 *   post:
 *     summary: Resume a paused session
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       202: { description: Session resuming }
 */
publicRouter.post("/:id/resume", authGuard, controllers.resumeSession);

/**
 * @swagger
 * /app/{id}/peers:
 *   post:
 *     summary: Add a peer to a session
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [peerId]
 *             properties:
 *               peerId: { type: string }
 *     responses:
 *       200: { description: Peer added }
 */
publicRouter.post(
  "/:id/peers",
  authGuard,
  validate(z.object({ peerId: z.string().regex(/^[0-9a-fA-F]{24}$/) })),
  controllers.addPeer,
);

/**
 * @swagger
 * /app/{id}/peers/{peerId}:
 *   delete:
 *     summary: Remove a peer from a session
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: peerId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Peer removed }
 */
publicRouter.delete("/:id/peers/:peerId", authGuard, controllers.removePeer);

// ─── Admin routes ──────────────────────────────────────────────────────────────

/**
 * @swagger
 * /admin/app:
 *   get:
 *     summary: Get all sessions (admin)
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200: { description: All sessions }
 */
adminRouter.get("/", controllers.getAllSessions);

/**
 * @swagger
 * /admin/app/{id}:
 *   get:
 *     summary: Get a session (admin)
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Session details }
 */
adminRouter.get("/:id", controllers.getSession);

/**
 * @swagger
 * /admin/app/{id}:
 *   delete:
 *     summary: Delete a session (admin)
 *     tags: [Sessions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Session deleted }
 */
adminRouter.delete("/:id", controllers.deleteSession);
