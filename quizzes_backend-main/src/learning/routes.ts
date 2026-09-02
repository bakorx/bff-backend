import { Router } from "express";
import {
  authGuard,
  authenticateUser,
  authorizeRoles,
  authorizeSubscription,
  enforceUsageLimit,
} from "@/middlewares";
import { validate } from "@/utils";
import * as controllers from "./controllers";
import {
  CourseSerializer,
  UpdateCourseSerializer,
  FlashcardSerializer,
  MaterialSerializer,
  PersonalQuizSerializer,
  QuestionSerializer,
  QuizSerializer,
  GenerateQuizAISerializer,
  TimetableSerializer,
  TimetableEntrySerializer,
  SyncTimetableSerializer,
  BatchQuizQuestionsSerializer,
  QuizQuestionUpdateSerializer,
  TriggerPublicQuizGenerationSerializer,
  TriggerPublicQuizGenerationForMaterialSerializer,
} from "./serializers";

const adminRouter = Router();
const publicRouter = Router();

// Apply authentication to all admin routes
adminRouter.use(
  authGuard,
  authorizeRoles("super_admin", "creator", "moderator"),
);

// ─── Admin Routes ──────────────────────────────────────────────────────────

/**
 * @swagger
 * /admin/learning/questions:
 *   post:
 *     summary: Create a new question
 *     description: Creates a question for a course. Requires admin or staff role.
 *     tags: [Learning]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Question'
 *     responses:
 *       201:
 *         description: Question created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Question'
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
  "/questions",
  validate(QuestionSerializer),
  controllers.createQuestion,
);
adminRouter.post(
  "/courses",
  validate(CourseSerializer),
  controllers.createCourse,
);
adminRouter.get("/courses", controllers.getAllCourses);
adminRouter.get("/courses/:id", controllers.getCourse);
/**
 * @swagger
 * /admin/learning/courses/{id}:
 *   patch:
 *     summary: Update a course
 *     description: Admin-only. Edits title, about (description), code, creditHours, and/or semester on a course.
 *     tags: [Learning]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the course
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               about:
 *                 type: string
 *               code:
 *                 type: string
 *               creditHours:
 *                 type: number
 *               semester:
 *                 type: number
 *     responses:
 *       200:
 *         description: Course updated
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: Course not found
 *       409:
 *         description: Course code already in use
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
adminRouter.patch(
  "/courses/:id",
  validate(UpdateCourseSerializer),
  controllers.updateCourse,
);

// ─── Admin: System Quizzes ────────────────────────────────────────────────────
adminRouter.get("/quizzes", controllers.adminGetQuizzes);
adminRouter.post(
  "/quizzes",
  validate(QuizSerializer),
  controllers.adminCreateQuiz,
);
adminRouter.post(
  "/quizzes/generate-ai",
  validate(GenerateQuizAISerializer),
  controllers.adminGenerateQuizAI,
);
adminRouter.post(
  "/public-quizzes/trigger-generation",
  validate(TriggerPublicQuizGenerationSerializer),
  controllers.adminTriggerPublicQuizGeneration,
);
adminRouter.post(
  "/public-quizzes/trigger-generation/:libraryMaterialId",
  validate(TriggerPublicQuizGenerationForMaterialSerializer),
  controllers.adminTriggerPublicQuizGenerationForMaterial,
);
adminRouter.get("/quizzes/:id", controllers.adminGetQuiz);
adminRouter.patch("/quizzes/:id", controllers.adminPatchQuiz);
adminRouter.delete("/quizzes/:id", controllers.adminDeleteQuiz);
adminRouter.patch("/quizzes/:id/publish", controllers.adminPublishQuiz);
adminRouter.patch("/quizzes/:id/archive", controllers.adminArchiveQuiz);
adminRouter.post("/quizzes/:id/lectures", controllers.adminAddQuizLecture);
adminRouter.post("/quizzes/:id/lectures/:lectureIndex/topics", controllers.adminAddQuizTopic);
adminRouter.post("/quizzes/:id/questions", controllers.adminAddQuizQuestion);
adminRouter.post(
  "/quizzes/:id/questions/batch",
  validate(BatchQuizQuestionsSerializer),
  controllers.adminBatchUploadQuizQuestions,
);
/**
 * @swagger
 * /admin/learning/quizzes/{id}/questions/{questionId}:
 *   patch:
 *     summary: Update an inner question of a quiz
 *     description: >
 *       Partial-update an inner Question document by id. The quiz bundle
 *       (QuizQuestion) is left untouched; the ObjectId refs in
 *       `quizQuestions[].questions[]` continue to point at the same Question.
 *       `lectureIndex` and `topicIndex` are stripped — moving a question
 *       between lectures/topics is a separate operation.
 *     tags: [Learning]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the quiz
 *       - in: path
 *         name: questionId
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the inner Question to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/QuizQuestionUpdate'
 *     responses:
 *       200:
 *         description: Question updated
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: Question not found
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
adminRouter.patch(
  "/quizzes/:id/questions/:questionId",
  validate(QuizQuestionUpdateSerializer),
  controllers.adminUpdateQuizQuestion,
);
adminRouter.delete(
  "/quizzes/:id/questions/:questionId",
  controllers.adminRemoveQuizQuestion,
);

// -- Admin: Timetables
adminRouter.get("/timetables", controllers.adminListTimetables);
adminRouter.post(
  "/timetables",
  validate(TimetableSerializer),
  controllers.adminCreateTimetable,
);
adminRouter.get("/timetables/:id", controllers.adminGetTimetable);
adminRouter.patch("/timetables/:id", controllers.adminUpdateTimetable);
adminRouter.patch("/timetables/:id/publish", controllers.adminPublishTimetable);
adminRouter.post(
  "/timetables/:id/entries",
  validate(TimetableEntrySerializer),
  controllers.adminAddTimetableEntry,
);
adminRouter.patch(
  "/timetables/:id/entries/:entryId",
  controllers.adminUpdateTimetableEntry,
);
adminRouter.delete(
  "/timetables/:id/entries/:entryId",
  controllers.adminRemoveTimetableEntry,
);
adminRouter.post(
  "/timetables/sync",
  validate(SyncTimetableSerializer),
  controllers.adminSyncTimetable,
);

// ─── Public Routes ─────────────────────────────────────────────────────────

/**
 * @swagger
 * /learning/flashcards:
 *   post:
 *     summary: Create a flashcard
 *     description: Requires an active subscription with the `personal:flashcards` permission.
 *     tags: [Learning]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Flashcard'
 *     responses:
 *       201:
 *         description: Flashcard created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Flashcard'
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
  "/flashcards",
  authenticateUser,
  authorizeSubscription("personal:flashcards"),
  validate(FlashcardSerializer),
  enforceUsageLimit("flashcardSets"),
  controllers.createFlashcard,
);
publicRouter.get("/courses", controllers.getCourses);

// ─── Public: System Quizzes ───────────────────────────────────────────────────
// List is unauthenticated — browsable landing
publicRouter.get("/quizzes", controllers.getQuizzes);
// Detail is browsable - browsing does not track attempts
publicRouter.get("/quizzes/:id", controllers.getQuiz);
publicRouter.post("/quizzes/:id/start", authGuard, controllers.startQuizAttempt);
publicRouter.post("/quizzes/:id/confirm-attempt", authGuard, controllers.confirmQuizAttempt);

/**
 * @swagger
 * /learning/courses/{courseId}/flashcards:
 *   get:
 *     summary: Get flashcards for a course
 *     description: Requires an active subscription with the `personal:flashcards` permission.
 *     tags: [Learning]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the course
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SortByParam'
 *       - $ref: '#/components/parameters/SortOrderParam'
 *       - $ref: '#/components/parameters/SearchParam'
 *       - in: query
 *         name: difficulty
 *         schema:
 *           type: string
 *           enum: [easy, medium, hard]
 *         description: Filter by difficulty level
 *       - in: query
 *         name: isPublic
 *         schema:
 *           type: boolean
 *         description: Filter by visibility
 *     responses:
 *       200:
 *         description: Paginated array of flashcard objects
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.get(
  "/courses/:courseId/flashcards",
  authGuard,
  authorizeSubscription("personal:flashcards"),
  controllers.getCourseFlashcards,
);

/**
 * @swagger
 * /learning/materials:
 *   post:
 *     summary: Upload a learning material
 *     description: >
 *       Uploads lecture notes or source files for AI processing.
 *       Requires an active subscription with the `content:create` permission.
 *     tags: [Learning]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Material'
 *     responses:
 *       201:
 *         description: Material uploaded and queued for processing
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Material'
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
  "/materials",
  authenticateUser,
  authorizeSubscription("content:create"),
  validate(MaterialSerializer),
  enforceUsageLimit("materialUploads"),
  controllers.createMaterial,
);

/**
 * @swagger
 * /learning/courses/{courseId}/materials:
 *   get:
 *     summary: Get all materials for a course
 *     tags: [Learning]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the course
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SortByParam'
 *       - $ref: '#/components/parameters/SortOrderParam'
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [pdf, doc, slides, text, img, link, data]
 *         description: Filter by material type
 *       - in: query
 *         name: isProcessed
 *         schema:
 *           type: boolean
 *         description: Filter by processing status
 *     responses:
 *       200:
 *         description: Paginated array of material objects
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.get(
  "/courses/:courseId/materials",
  authGuard,
  controllers.getCourseMaterials,
);

/**
 * @swagger
 * /learning/courses/{courseId}/questions:
 *   get:
 *     summary: Get questions for a course
 *     tags: [Learning]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the course
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SortByParam'
 *       - $ref: '#/components/parameters/SortOrderParam'
 *       - $ref: '#/components/parameters/SearchParam'
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [mcq, fill-in, true-false]
 *         description: Filter by question type
 *       - in: query
 *         name: isModerated
 *         schema:
 *           type: boolean
 *         description: Filter by moderation status
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *         description: Filter by academic year
 *     responses:
 *       200:
 *         description: Paginated array of question objects
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.get(
  "/courses/:courseId/questions",
  authGuard,
  controllers.getCourseQuestions,
);

/**
 * @swagger
 * /learning/personal-quizzes:
 *   post:
 *     summary: Create a personal quiz
 *     description: >
 *       Generates a personal quiz from an uploaded material.
 *       Requires an active subscription with the `personal:quizzes` permission.
 *     tags: [Learning]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PersonalQuiz'
 *     responses:
 *       201:
 *         description: Personal quiz created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PersonalQuiz'
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
  "/personal-quizzes",
  authenticateUser,
  authorizeSubscription("personal:quizzes"),
  validate(PersonalQuizSerializer),
  enforceUsageLimit("quizGenerations"),
  controllers.createPersonalQuiz,
);

// ─── Public: Exam Timetable ────────────────────────────────────────────────
publicRouter.get("/timetable/me", authGuard, controllers.getMyTimetable);
publicRouter.get("/timetables/public", controllers.getPublicTimetables);
publicRouter.post(
  "/timetables/guest-reminders",
  controllers.subscribeGuestTimetableReminders,
);

// ─── Public Library ────────────────────────────────────────────────────────
publicRouter.get("/library", controllers.getPublicLibrary);
publicRouter.get("/library/:id", controllers.getPublicLibraryItem);
publicRouter.get("/library/:id/download", controllers.downloadLibraryMaterial);
publicRouter.post(
  "/library/:id/import",
  authenticateUser,
  enforceUsageLimit("materialUploads"),
  controllers.importLibraryMaterial,
);
publicRouter.post("/library/submit", authGuard, authorizeSubscription("content:create"), controllers.submitToLibrary);

// ─── Admin: Library ────────────────────────────────────────────────────────
adminRouter.get("/library", controllers.adminListLibraryItems);
adminRouter.post("/library", controllers.adminPublishToLibrary);
adminRouter.patch("/library/:id/review", controllers.adminReviewLibraryItem);

export { adminRouter, publicRouter };
