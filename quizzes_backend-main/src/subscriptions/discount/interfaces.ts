import { Document, Types } from "mongoose";

export interface IPromoEligibility {
  newUsersOnly?: boolean;
  firstPurchaseOnly?: boolean;
  includeCourseIds?: Types.ObjectId[];
  requireAllCourseIds?: boolean;
  includeTiers?: Array<"cooked" | "cruising" | "locked_in">;
  includeDurations?: Array<"daily" | "weekly" | "semester">;
  minOrderAmountGHS?: number | null;
  maxOrderAmountGHS?: number | null;
  minStreakDays?: number;
  hasPendingReferralReward?: boolean;
  hasCompletedOnboarding?: boolean;
  inactiveForDays?: number | null;
  firstNDaysAfterSignup?: number | null;
  maxUsesPerUser?: number | null;
}

export interface IPromoCode extends Document {
  _id: Types.ObjectId;
  code: string; // unique, uppercase
  type: "percentage" | "flat";
  value: number; // % off or GHS off
  expiresAt: Date | null;
  maxUses: number | null; // null = unlimited
  usedCount: number;
  isActive: boolean;
  eligibility?: IPromoEligibility;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface DiscountApplication {
  type: "promo" | "student" | "referral" | "loyalty";
  label: string;
  percentage: number;
}

export interface DiscountResult {
  finalAmountGHS: number;
  originalAmountGHS: number;
  discounts: DiscountApplication[];
  totalDiscountPercentage: number;
  promoCodeCheck?: {
    code: string;
    valid: boolean;
    reason?: string;
  };
}
