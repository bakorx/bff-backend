import { Router } from "express";
import * as controllers from "./controllers";
import { validate } from "@/utils";
import { PromoCodeSerializer, ValidatePromoSerializer } from "./serializers";
import { authGuard, authorizeRoles } from "@/middlewares";

export const adminDiscountRouter = Router();
export const publicDiscountRouter = Router();

adminDiscountRouter.use(
  authGuard,
  authorizeRoles("super_admin", "creator"),
);

/**
 * @swagger
 * /admin/subscriptions/promo-codes:
 *   post:
 *     summary: Create a promo code
 *     tags: [Discounts]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PromoCode'
 *     responses:
 *       201:
 *         description: Promo code created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PromoCode'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
adminDiscountRouter.post(
  "/promo-codes",
  validate(PromoCodeSerializer),
  controllers.createPromoCode,
);

/**
 * @swagger
 * /admin/subscriptions/promo-codes:
 *   get:
 *     summary: List promo codes
 *     tags: [Discounts]
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
 *         description: Paginated list of promo codes
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
adminDiscountRouter.get("/promo-codes", controllers.listPromoCodes);

/**
 * @swagger
 * /admin/subscriptions/promo-codes/{id}:
 *   patch:
 *     summary: Update a promo code
 *     tags: [Discounts]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: MongoDB ObjectId of the promo code
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PromoCode'
 *     responses:
 *       200:
 *         description: Updated promo code
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PromoCode'
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
adminDiscountRouter.patch("/promo-codes/:id", controllers.updatePromoCode);

/**
 * @swagger
 * /admin/subscriptions/promo-codes/{id}:
 *   delete:
 *     summary: Delete a promo code
 *     tags: [Discounts]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: MongoDB ObjectId of the promo code
 *     responses:
 *       200:
 *         description: Promo code deleted
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
adminDiscountRouter.delete("/promo-codes/:id", controllers.deletePromoCode);

/**
 * @swagger
 * /subscriptions/promo-codes/validate:
 *   post:
 *     summary: Validate a promo code
 *     tags: [Discounts]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code: { type: string, example: SAVE20 }
 *               packageId: { type: string, description: Optional package ObjectId to check against }
 *     responses:
 *       200:
 *         description: Promo code is valid
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PromoCode'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
publicDiscountRouter.post(
  "/promo-codes/validate",
  authGuard,
  validate(ValidatePromoSerializer),
  controllers.validatePromoCode,
);
