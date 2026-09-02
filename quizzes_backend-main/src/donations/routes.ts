import { Router } from "express";
import { attachUser } from "@/middlewares";
import * as controllers from "./controllers";

const donationRouter = Router();

/**
 * @swagger
 * /donations/initiate:
 *   post:
 *     summary: Initiate a donation via Paystack
 *     tags: [Donations]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, amount]
 *             properties:
 *               email: { type: string, format: email }
 *               amount: { type: number, minimum: 1 }
 *               currency: { type: string, default: GHS }
 *               message: { type: string }
 *     responses:
 *       200:
 *         description: Paystack authorization URL
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 authorizationUrl: { type: string }
 *                 reference: { type: string }
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
donationRouter.post("/initiate", attachUser, controllers.initiateDonation);

/**
 * @swagger
 * /donations/verify/{reference}:
 *   get:
 *     summary: Verify a donation by Paystack reference
 *     tags: [Donations]
 *     parameters:
 *       - in: path
 *         name: reference
 *         required: true
 *         schema: { type: string }
 *         description: Paystack transaction reference
 *     responses:
 *       200:
 *         description: Donation verification result
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Donation'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
donationRouter.get("/verify/:reference", controllers.verifyDonation);

/**
 * @swagger
 * /donations/ledger:
 *   get:
 *     summary: Get the donation ledger
 *     tags: [Donations]
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SortByParam'
 *       - $ref: '#/components/parameters/SortOrderParam'
 *     responses:
 *       200:
 *         description: Paginated list of donations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Donation'
 *                 total: { type: integer }
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
donationRouter.get("/ledger", controllers.getDonationLedger);

export { donationRouter };
