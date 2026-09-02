import { Schema, model, Model } from "mongoose";
import { IPromoCode } from "./interfaces";

const PromoCodeSchema = new Schema<IPromoCode>(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ["percentage", "flat"],
      required: true,
    },
    value: {
      type: Number,
      required: true,
      min: 0,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    maxUses: {
      type: Number,
      default: null,
    },
    usedCount: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    eligibility: {
      newUsersOnly: { type: Boolean, default: false },
      firstPurchaseOnly: { type: Boolean, default: false },
      includeCourseIds: [{ type: Schema.Types.ObjectId, ref: "Course" }],
      requireAllCourseIds: { type: Boolean, default: false },
      includeTiers: [
        {
          type: String,
          enum: ["cooked", "cruising", "locked_in"],
        },
      ],
      includeDurations: [
        {
          type: String,
          enum: ["daily", "weekly", "semester"],
        },
      ],
      minOrderAmountGHS: { type: Number, default: null },
      maxOrderAmountGHS: { type: Number, default: null },
      minStreakDays: { type: Number, default: 0 },
      hasPendingReferralReward: { type: Boolean, default: false },
      hasCompletedOnboarding: { type: Boolean, default: false },
      inactiveForDays: { type: Number, default: null },
      firstNDaysAfterSignup: { type: Number, default: null },
      maxUsesPerUser: { type: Number, default: null },
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

PromoCodeSchema.index({ isActive: 1, expiresAt: 1 });

export const PromoCode: Model<IPromoCode> = model<IPromoCode>(
  "PromoCode",
  PromoCodeSchema,
);
