import { Request, Response, NextFunction, RequestHandler } from "express";
import { Permission, PlatformRole, ROLE_PERMISSIONS } from "@/users";
import { STATUS_CODES } from "@/config";
import { sendError } from "@/utils";
import { FeatureKey, UsageChecker, checkUsageAllowance, CREDIT_COSTS } from "@/subscriptions";
import { SUBSCRIPTION_PERMISSIONS } from "./constants";

/**
 * Middleware to check if a user has a specific subscription-based permission
 * or if they are a super_admin.
 */
export const authorizeSubscription = (permission: Permission) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        res
          .status(STATUS_CODES.UNAUTHORIZED)
          .json({ message: "Authentication required" });
        return;
      }

      const isSubPerm = SUBSCRIPTION_PERMISSIONS.includes(permission);

      if (isSubPerm) {
        if (req.user.role === "super_admin") {
          return next();
        }

        if (!req.user.isSubscribed) {
          res.status(STATUS_CODES.FORBIDDEN).json({
            message:
              "An active subscription is required to access this feature.",
          });
          return;
        }

        const role = req.user.role;
        const perms = role ? ROLE_PERMISSIONS[role as PlatformRole] || [] : [];
        const hasPermission = perms.includes(permission);

        if (!hasPermission) {
          res.status(STATUS_CODES.FORBIDDEN).json({
            message: "Your role does not allow access to this feature.",
          });
          return;
        }
      }

      next();
    } catch (error) {
      res.status(500).json({ message: "Subscription authorization failed" });
    }
  };
};


/**
 * Factory that returns an Express middleware enforcing per-feature daily limits.
 */
export function createEnforceUsageLimit(
  checker: UsageChecker = checkUsageAllowance,
) {
  return (feature: FeatureKey): RequestHandler =>
    async (req, res, next) => {
      try {
        const userId = (req as any).user?.id ?? (req as any).user?._id;
        if (!userId) {
          return sendError(res, "Unauthorized", 401);
        }

        // Super admins bypass all usage limits
        if ((req as any).user?.role === "super_admin") {
          res.locals.usageResult = {
            allowed: true,
            remaining: null,
            source: "plan",
          };
          return next();
        }

        const result = await checker(userId, feature);

        if (!result.allowed) {
          const creditCost = CREDIT_COSTS[feature];
          return res.status(402).json({
            success: false,
            message: "Daily limit reached",
            data: null,
            error: {
              code: "QUOTA_EXCEEDED",
              feature,
              creditsRequired: creditCost,
            },
          });
        }

        res.locals.usageResult = result;
        next();
      } catch (error: any) {
        return sendError(res, error.message ?? "Usage check failed", 500);
      }
    };
}

export function enforceUsageLimit(feature: FeatureKey): RequestHandler {
  return createEnforceUsageLimit()(feature);
}
