import { z } from "zod";

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/);

const promoEligibilitySchema = z
  .object({
    newUsersOnly: z.boolean().optional(),
    firstPurchaseOnly: z.boolean().optional(),
    includeCourseIds: z.array(objectIdSchema).optional(),
    requireAllCourseIds: z.boolean().optional(),
    includeTiers: z
      .array(z.enum(["cooked", "cruising", "locked_in"]))
      .optional(),
    includeDurations: z
      .array(z.enum(["daily", "weekly", "semester"]))
      .optional(),
    minOrderAmountGHS: z.number().min(0).nullable().optional(),
    maxOrderAmountGHS: z.number().min(0).nullable().optional(),
    minStreakDays: z.number().int().min(0).optional(),
    hasPendingReferralReward: z.boolean().optional(),
    hasCompletedOnboarding: z.boolean().optional(),
    inactiveForDays: z.number().int().min(1).nullable().optional(),
    firstNDaysAfterSignup: z.number().int().min(1).nullable().optional(),
    maxUsesPerUser: z.number().int().positive().nullable().optional(),
  })
  .optional();

export const PromoCodeSerializer = z
  .object({
    code: z.string().min(3).max(20).toUpperCase().describe("Promo code string"),
    type: z.enum(["percentage", "flat"]).describe("Discount type"),
    value: z.number().min(0).describe("Percentage off or flat GHS off"),
    expiresAt: z
      .string()
      .datetime()
      .nullable()
      .optional()
      .describe("Expiry ISO date"),
    maxUses: z
      .number()
      .int()
      .positive()
      .nullable()
      .optional()
      .describe("Max redemptions"),
    isActive: z.boolean().default(true),
    eligibility: promoEligibilitySchema,
  })
  .describe("Serializer for admin promo code creation");

export const ValidatePromoSerializer = z
  .object({
    code: z.string().min(1).optional().describe("Promo code to validate"),
    referralCode: z
      .string()
      .min(1)
      .optional()
      .describe("Referral code to validate"),
    packageId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/)
      .optional()
      .describe("Package being purchased"),
    bundleId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/)
      .optional()
      .describe("Credit bundle being purchased"),
  })
  .describe("Serializer for promo code validation preview");
