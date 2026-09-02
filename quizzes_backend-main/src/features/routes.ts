import { Router } from "express";
import { authGuard, authorizeRoles } from "@/middlewares";
import { validate } from "@/utils";
import * as controllers from "./controllers";
import {
  FeatureFlagCreateSerializer,
  FeatureFlagUpdateSerializer,
} from "./serializers";

const adminRouter = Router();

// super_admin only — flag flips are platform-wide.
adminRouter.use(authGuard, authorizeRoles("super_admin"));

/**
 * @swagger
 * /admin/system/features:
 *   get:
 *     summary: List all feature flags
 *     tags: [Features]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Array of feature flags
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
adminRouter.get("/", controllers.listFlags);

/**
 * @swagger
 * /admin/system/features:
 *   post:
 *     summary: Create a feature flag
 *     tags: [Features]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/FeatureFlag'
 *     responses:
 *       201:
 *         description: Created flag
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 */
adminRouter.post(
  "/",
  validate(FeatureFlagCreateSerializer),
  controllers.createFlag,
);

/**
 * @swagger
 * /admin/system/features/{key}/audit:
 *   get:
 *     summary: Audit history for a feature flag
 *     tags: [Features]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema: { type: string }
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200:
 *         description: Paginated audit history
 */
adminRouter.get("/:key/audit", controllers.getFlagAudit);

/**
 * @swagger
 * /admin/system/features/{key}:
 *   get:
 *     summary: Fetch one feature flag
 *     tags: [Features]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema: { type: string }
 *         description: Flag key (snake_case)
 *     responses:
 *       200:
 *         description: The feature flag
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
adminRouter.get("/:key", controllers.getFlag);

/**
 * @swagger
 * /admin/system/features/{key}:
 *   patch:
 *     summary: Update a feature flag
 *     tags: [Features]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/FeatureFlag'
 *     responses:
 *       200:
 *         description: Updated flag
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
adminRouter.patch(
  "/:key",
  validate(FeatureFlagUpdateSerializer),
  controllers.updateFlag,
);

/**
 * @swagger
 * /admin/system/features/{key}:
 *   delete:
 *     summary: Delete a feature flag
 *     tags: [Features]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Flag deleted
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
adminRouter.delete("/:key", controllers.deleteFlag);

export { adminRouter };
