import { Router } from "express";
import {
  authGuard,
  authorizeRoles,
  authenticateUser,
  attachUser,
  onboardingGuard,
} from "@/middlewares";
import { validate } from "@/utils";
import * as controllers from "./controllers";
import {
  UserSerializer,
  UserUpdateSerializer,
  ProfileCheckSerializer,
  ProfileUpdateSerializer,
  NotificationSettingsUpdateSerializer,
} from "./serializers";

const adminRouter = Router();
const publicRouter = Router();

// Apply authentication to admin routes
adminRouter.use(
  authGuard,
  authorizeRoles("super_admin", "creator", "moderator"),
);

/**
 * @swagger
 * /admin/users/users:
 *   post:
 *     summary: Create a new user
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/User'
 *     responses:
 *       201:
 *         description: User created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
adminRouter.post("/users", validate(UserSerializer), controllers.createUser);

/**
 * @swagger
 * /admin/users/check-profile:
 *   post:
 *     summary: Check profile field validity (username availability, current password)
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProfileCheck'
 *     responses:
 *       200:
 *         description: Check results
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

/**
 * @swagger
 * /admin/users/profile:
 *   patch:
 *     summary: Update own admin profile (username, password)
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProfileUpdate'
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
adminRouter.patch(
  "/profile",
  authenticateUser,
  validate(ProfileUpdateSerializer),
  controllers.updateMyProfile,
);

/**
 * @swagger
 * /admin/users/users:
 *   get:
 *     summary: List all users
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SortByParam'
 *       - $ref: '#/components/parameters/SortOrderParam'
 *       - $ref: '#/components/parameters/SearchParam'
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [student, admin, moderator, super_admin]
 *         description: Filter by role
 *       - in: query
 *         name: isSubscribed
 *         schema:
 *           type: boolean
 *         description: Filter by subscription status
 *       - in: query
 *         name: isBanned
 *         schema:
 *           type: boolean
 *         description: Filter by banned status
 *     responses:
 *       200:
 *         description: Paginated array of user objects
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
adminRouter.get("/users", controllers.getUsers);

/**
 * @swagger
 * /admin/users/users/{id}:
 *   get:
 *     summary: Get a user by ID
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the user
 *     responses:
 *       200:
 *         description: User object
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
adminRouter.get("/users/:id", controllers.getUser);

/**
 * @swagger
 * /admin/users/users/{id}:
 *   patch:
 *     summary: Update a user's details as an admin
 *     tags: [Users]
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
 *             $ref: '#/components/schemas/UserUpdate'
 *     responses:
 *       200:
 *         description: User updated successfully
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
adminRouter.patch("/users/:id", validate(UserUpdateSerializer), controllers.updateUser);

/**
 * @swagger
 * /admin/users/users/{id}:
 *   delete:
 *     summary: Delete a user by ID
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the user
 *     responses:
 *       200:
 *         description: User deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
adminRouter.delete("/users/:id", controllers.deleteUser);

// Public Routes (authGuard on specific routes that require user identifying themselves)

/**
 * @swagger
 * /users/users/{id}:
 *   get:
 *     summary: Get own user profile
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the user
 *     responses:
 *       200:
 *         description: User profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.get("/users/:id", authGuard, onboardingGuard, controllers.getUser);

/**
 * @swagger
 * /users/users/{id}:
 *   patch:
 *     summary: Update own user profile
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserUpdate'
 *     responses:
 *       200:
 *         description: Updated user profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.patch(
  "/users/:id",
  authGuard,
  onboardingGuard,
  validate(UserUpdateSerializer),
  controllers.updateUser,
);

/**
 * @swagger
 * /users/profile:
 *   get:
 *     summary: Get own profile
 *     description: Returns the full profile of the currently authenticated user, resolved from the auth token rather than a client-supplied id.
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.get("/profile", authenticateUser, controllers.getMyProfile);

publicRouter.patch(
  "/profile",
  authenticateUser,
  validate(ProfileUpdateSerializer),
  controllers.updateMyProfile,
);

/**
 * @swagger
 * /users/profile:
 *   patch:
 *     summary: Update own profile
 *     description: Updates the authenticated user's profile fields such as username, name, or password.
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProfileUpdate'
 *     responses:
 *       200:
 *         description: Profile updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */

/**
 * @swagger
 * /users/notifications:
 *   get:
 *     summary: Get notification settings for the authenticated user
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Notification settings object
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.get(
  "/notifications",
  authGuard,
  onboardingGuard,
  controllers.getMyNotificationSettings,
);

/**
 * @swagger
 * /users/notifications:
 *   patch:
 *     summary: Update notification settings for the authenticated user
 *     description: >
 *       Partial-update of the authenticated user's notification settings.
 *       Body shape mirrors the GET response (flat object, no
 *       `notificationSettings` wrapper) — send any subset of the
 *       `NotificationSettings` fields. Includes the opt-in `weeklyDigest`
 *       boolean for the weekly study digest email.
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NotificationSettingsUpdate'
 *     responses:
 *       200:
 *         description: Notification settings updated
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.patch(
  "/notifications",
  authGuard,
  onboardingGuard,
  validate(NotificationSettingsUpdateSerializer),
  controllers.updateMyNotificationSettings,
);

/**
 * @swagger
 * /users/check:
 *   post:
 *     summary: Check profile field validity (username availability, optionally current password if logged in)
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProfileCheck'
 *     responses:
 *       200:
 *         description: Check results
 */
publicRouter.post(
  "/check",
  attachUser,
  validate(ProfileCheckSerializer),
  controllers.checkProfile,
);

// Onboarding Routes

/**
 * @swagger
 * /users/onboarding/status:
 *   get:
 *     summary: Get the authenticated user's onboarding status
 *     description: Returns the current onboarding object including completion flag, current step index, and per-step completion booleans.
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Onboarding status retrieved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OnboardingStatus'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.get(
  "/onboarding/status",
  authGuard,
  onboardingGuard,
  controllers.getOnboardingStatus,
);

/**
 * @swagger
 * /users/onboarding/step:
 *   patch:
 *     summary: Mark an onboarding step as complete
 *     description: >
 *       Updates the specified onboarding step to completed and recalculates the overall onboarding
 *       completion status. Returns the updated onboarding object.
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [step]
 *             properties:
 *               step:
 *                 type: string
 *                 enum: [profile, yearOfStudy, pushOptIn, zIntro]
 *                 description: The onboarding step key to mark as complete
 *               data:
 *                 type: object
 *                 description: Optional step-specific payload
 *     responses:
 *       200:
 *         description: Onboarding step updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OnboardingStatus'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.patch(
  "/onboarding/step",
  authGuard,
  onboardingGuard,
  controllers.updateOnboardingStep,
);

// --- ENROLLMENTS ---

/**
 * @swagger
 * /users/me/courses:
 *   get:
 *     summary: Get the authenticated user's enrolled courses
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200:
 *         description: List of enrolled courses
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.get(
  "/me/courses",
  authGuard,
  onboardingGuard,
  controllers.getMyEnrollments,
);

/**
 * @swagger
 * /users/me/courses:
 *   post:
 *     summary: Enroll the authenticated user in a course
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [courseId]
 *             properties:
 *               courseId: { type: string, description: MongoDB ObjectId of the course }
 *     responses:
 *       201:
 *         description: Enrolled successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.post(
  "/me/courses",
  authGuard,
  onboardingGuard,
  controllers.enrollMe,
);

/**
 * @swagger
 * /users/me/courses/{courseId}:
 *   delete:
 *     summary: Unenroll the authenticated user from a course
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema: { type: string }
 *         description: MongoDB ObjectId of the course
 *     responses:
 *       200:
 *         description: Unenrolled successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.delete(
  "/me/courses/:courseId",
  authGuard,
  onboardingGuard,
  controllers.unenrollMe,
);

export { adminRouter, publicRouter };
