import { Router } from "express";
import { authenticateUser, authLimiter, forgotPasswordLimiter } from "@/middlewares";
import { validate } from "@/utils";
import { login, refresh, logout, forgotPassword, resetPassword, signup } from "./controllers";
import { oauthGoogleLogin } from "./controllers";
import {
  SignupSerializer,
  GoogleOAuthLoginSerializer,
} from "./serializers";

const authRoutes: Router = Router();

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Login with username and password
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Successful login — returns access and refresh tokens
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Account suspended
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
authRoutes.post("/login", authLimiter, login);

/**
 * @swagger
 * /auth/signup:
 *   post:
 *     summary: Register a new user account
 *     description: >
 *       Creates a new student account, issues JWT access and refresh tokens,
 *       and sends a welcome email with onboarding instructions.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SignupRequest'
 *     responses:
 *       201:
 *         description: Account created — returns access and refresh tokens with the new user payload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SignupResponse'
 *       409:
 *         description: Email or username already in use
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       429:
 *         description: Too many signup attempts
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
authRoutes.post("/signup", authLimiter, validate(SignupSerializer), signup);

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: Refresh the access token using a valid refresh token
 *     tags: [Auth]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TokenRefreshRequest'
 *     responses:
 *       200:
 *         description: New access token issued
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TokenRefreshResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
authRoutes.post("/refresh", refresh);
authRoutes.post("/logout", logout);

/**
 * @swagger
 * /auth/forgot-password:
 *   post:
 *     summary: Request a password reset link
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       200:
 *         description: Success message (always returns this even if email not found)
 *       429:
 *         description: Too many attempts
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
authRoutes.post("/forgot-password", forgotPasswordLimiter, forgotPassword);

/**
 * @swagger
 * /auth/reset-password:
 *   post:
 *     summary: Reset password using a valid token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, newPassword]
 *             properties:
 *               token: { type: string }
 *               newPassword: { type: string, minLength: 8 }
 *     responses:
 *       200:
 *         description: Password changed successfully
 *       400:
 *         description: Invalid or expired token
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
authRoutes.post("/reset-password", resetPassword);

/**
 * @swagger
 * /auth/oauth/google:
 *   post:
 *     summary: Log in or sign up with a Google id_token
 *     description: >
 *       Verifies a Google `id_token` (obtained from Google Identity Services on
 *       the client) and resolves the user account. If the Google account is
 *       already linked, the user is logged in. If a user exists with the same
 *       email but no Google link, the provider is auto-linked and the user is
 *       logged in (a notification email is sent). Otherwise a new account is
 *       created and the user is logged in.
 *       Returns `{ user, accessToken, refreshToken, status: 'logged_in' }`.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GoogleOAuthLogin'
 *     responses:
 *       200:
 *         description: Logged in (existing or auto-linked account)
 *       201:
 *         description: New account created via Google
 *       409:
 *         description: The Google account is already linked to a different user
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
authRoutes.post(
  "/oauth/google",
  authLimiter,
  validate(GoogleOAuthLoginSerializer),
  oauthGoogleLogin,
);

export { authRoutes };
