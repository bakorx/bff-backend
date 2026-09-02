import { Router } from 'express';
import express from 'express';
import { authGuard, authorizeRoles } from '@/middlewares';
import { validate } from '@/utils';
import * as controllers from './controllers';
import {
  PackageSerializer,
  PaymentSerializer,
  InitiatePaymentSerializer,
} from './serializers';

const adminRouter = Router();
const publicRouter = Router();

// Apply authentication to all admin routes
adminRouter.use(authGuard, authorizeRoles('super_admin', 'creator', 'moderator'));

// ─── Admin — Packages ──────────────────────────────────────────────────────

/**
 * @swagger
 * /admin/subscriptions/packages:
 *   post:
 *     summary: Create a subscription package / plan
 *     tags: [Subscriptions]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Package'
 *     responses:
 *       201:
 *         description: Package created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Package'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
adminRouter.post('/packages', validate(PackageSerializer), controllers.createPackage);

/**
 * @swagger
 * /admin/subscriptions/packages:
 *   get:
 *     summary: List all subscription packages
 *     tags: [Subscriptions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SortByParam'
 *       - $ref: '#/components/parameters/SortOrderParam'
 *       - $ref: '#/components/parameters/SearchParam'
 *       - in: query
 *         name: access
 *         schema:
 *           type: string
 *           enum: [quiz, course, duration, default]
 *         description: Filter by access type
 *       - in: query
 *         name: isUpgradable
 *         schema:
 *           type: boolean
 *         description: Filter to upgradable packages only
 *     responses:
 *       200:
 *         description: Paginated array of package objects
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
adminRouter.get('/packages', controllers.getPackages);

/**
 * @swagger
 * /admin/subscriptions/packages/{id}:
 *   get:
 *     summary: Get a subscription package by ID
 *     tags: [Subscriptions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the package
 *     responses:
 *       200:
 *         description: Package object
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Package'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
adminRouter.get('/packages/:id', controllers.getPackage);

// ─── Admin — Payments ──────────────────────────────────────────────────────

/**
 * @swagger
 * /admin/subscriptions/payments:
 *   get:
 *     summary: List all payments
 *     tags: [Subscriptions]
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
 *         name: status
 *         schema:
 *           type: string
 *           enum: [abandoned, failed, ongoing, pending, processing, queued, success, reversed]
 *         description: Filter by payment status
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [course, quiz, duration, credits, default]
 *         description: Filter by payment type
 *     responses:
 *       200:
 *         description: Paginated array of payment objects
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
adminRouter.get('/payments', controllers.getAllPayments);

/**
 * @swagger
 * /admin/subscriptions/payments/{id}:
 *   get:
 *     summary: Get a payment by ID
 *     tags: [Subscriptions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the payment
 *     responses:
 *       200:
 *         description: Payment object
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Payment'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
adminRouter.get('/payments/:id', controllers.getPayment);

// ─── Admin — Subscriptions ─────────────────────────────────────────────────

/**
 * @swagger
 * /admin/subscriptions/subscriptions:
 *   get:
 *     summary: List all user subscriptions
 *     tags: [Subscriptions]
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
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, expired, cancelled]
 *         description: Filter by subscription status
 *     responses:
 *       200:
 *         description: Paginated array of subscription objects
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
adminRouter.get('/subscriptions', controllers.getAllSubscriptions);

/**
 * @swagger
 * /admin/subscriptions/subscriptions/{id}:
 *   get:
 *     summary: Get a subscription by ID
 *     tags: [Subscriptions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the subscription
 *     responses:
 *       200:
 *         description: Subscription object
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Subscription'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
adminRouter.get('/subscriptions/:id', controllers.getSubscription);

// ─── Public — Packages ─────────────────────────────────────────────────────

/**
 * @swagger
 * /subscriptions/packages:
 *   get:
 *     summary: List available subscription packages
 *     tags: [Subscriptions]
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SortByParam'
 *       - $ref: '#/components/parameters/SortOrderParam'
 *       - $ref: '#/components/parameters/SearchParam'
 *       - in: query
 *         name: access
 *         schema:
 *           type: string
 *           enum: [quiz, course, duration, default]
 *         description: Filter by access type
 *     responses:
 *       200:
 *         description: Paginated array of package objects
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.get('/packages', controllers.getPackages);
publicRouter.get('/referral/public-lookup/:code', controllers.lookupReferrer);

/**
 * @swagger
 * /subscriptions/packages/{id}:
 *   get:
 *     summary: Get a subscription package by ID
 *     tags: [Subscriptions]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the package
 *     responses:
 *       200:
 *         description: Package object
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Package'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.get('/packages/:id', controllers.getPackage);

// ─── Public — Payments ─────────────────────────────────────────────────────

/**
 * @swagger
 * /subscriptions/payments/initiate:
 *   post:
 *     summary: Initiate a Paystack payment for a subscription package
 *     tags: [Subscriptions]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PaymentInitiateRequest'
 *     responses:
 *       200:
 *         description: Paystack authorization URL and access code
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 authorizationUrl:
 *                   type: string
 *                   format: uri
 *                   description: Redirect the user to this URL to complete payment
 *                 accessCode:
 *                   type: string
 *                 reference:
 *                   type: string
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.post('/payments/initiate', authGuard, validate(InitiatePaymentSerializer), controllers.initiatePayment);

/**
 * @swagger
 * /subscriptions/credits/initiate:
 *   post:
 *     summary: Initiate a paystack checkout for a credit bundle
 *     tags: [Subscriptions]
 *     security:
 *       - BearerAuth: []
 */
publicRouter.post('/credits/initiate', authGuard, controllers.initiateCreditPayment);

/**
 * @swagger
 * /subscriptions/payments/verify/{reference}:
 *   get:
 *     summary: Verify a Paystack payment by reference
 *     tags: [Subscriptions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *         description: Paystack transaction reference
 *     responses:
 *       200:
 *         description: Payment verified and subscription activated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Payment'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.get('/payments/verify/:reference', authGuard, controllers.verifyPayment);

/**
 * @swagger
 * /subscriptions/users/{userId}/subscriptions:
 *   get:
 *     summary: Get all subscriptions for a user
 *     tags: [Subscriptions]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the user
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SortByParam'
 *       - $ref: '#/components/parameters/SortOrderParam'
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, expired, cancelled]
 *         description: Filter by subscription status
 *     responses:
 *       200:
 *         description: Paginated array of subscription objects
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.get('/users/:userId/subscriptions', authGuard, controllers.getUserSubscriptions);

/**
 * @swagger
 * /subscriptions/payments/webhook:
 *   post:
 *     summary: Paystack payment webhook
 *     description: >
 *       Receives signed webhook events from Paystack. The request body must be
 *       the raw JSON buffer so the HMAC signature can be validated.
 *       This endpoint is **not** authenticated via Bearer token.
 *     tags: [Subscriptions]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Paystack webhook event payload
 *     responses:
 *       200:
 *         description: Webhook processed
 *       400:
 *         description: Invalid signature or malformed payload
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.post(
  '/payments/webhook',
  express.raw({ type: 'application/json' }),
  controllers.paystackWebhook
);

// ─── Credits ───────────────────────────────────────────────────────────────

/**
 * @swagger
 * /subscriptions/credits/bundles:
 *   get:
 *     summary: List available credit bundles
 *     tags: [Subscriptions]
 *     responses:
 *       200:
 *         description: Array of available credit bundle options
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.get('/credits/bundles', controllers.getCreditBundles);

/**
 * @swagger
 * /subscriptions/credits/initiate:
 *   post:
 *     summary: Initiate a credit purchase payment
 *     tags: [Subscriptions]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bundleId]
 *             properties:
 *               bundleId: { type: string, description: ObjectId of the credit bundle }
 *     responses:
 *       200:
 *         description: Paystack authorization URL for the credit purchase
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 authorizationUrl: { type: string }
 *                 reference: { type: string }
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.post('/credits/initiate', authGuard, controllers.initiateCreditPayment);

// ─── Billing Status ────────────────────────────────────────────────────────

/**
 * @swagger
 * /subscriptions/users/me/billing-status:
 *   get:
 *     summary: Get the authenticated user's current billing status
 *     tags: [Subscriptions]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Billing status including active subscription and credit balance
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 subscription:
 *                   $ref: '#/components/schemas/Subscription'
 *                 credits: { type: integer }
 *                 hasActiveSubscription: { type: boolean }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicRouter.get('/users/me/billing-status', authGuard, controllers.getBillingStatus);

/**
 * @swagger
 * /subscriptions/referral/me:
 *   get:
 *     summary: Get the authenticated user's referral status
 *     tags: [Subscriptions]
 *     security:
 *       - BearerAuth: []
 */
publicRouter.get('/referral/me', authGuard, controllers.getReferralStatus);

export { adminRouter, publicRouter };
