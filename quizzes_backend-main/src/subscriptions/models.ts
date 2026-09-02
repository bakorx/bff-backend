import mongoose, { Schema, model, Model } from "mongoose";
import { IPackage, IPayment, ISubscription, ICreditBundle } from "./interfaces";

const PackageSchema: Schema<IPackage> = new Schema(
  {
    // --- New tier/duration fields ---
    tier: {
      type: String,
      enum: ["cooked", "cruising", "locked_in"],
      required: false,
    },
    durationType: {
      type: String,
      enum: ["daily", "weekly", "semester"],
      required: false,
    },
    priceGHS: {
      type: Number,
      required: false,
    },
    limits: {
      tutorSessionsPerDay: { type: Number, default: null },
      quizGenerationsPerDay: { type: Number, default: null },
      flashcardSetsPerDay: { type: Number, default: null },
      mindMapsPerDay: { type: Number, default: null },
      materialUploadsPerDay: { type: Number, default: null },
      pdfExport: { type: Boolean, default: false },
      analyticsLevel: { type: String, enum: ["basic", "full"], default: "basic" },
      priorityProcessing: { type: Boolean, default: false },
      earlyFeatureAccess: { type: Boolean, default: false },
      bonusCreditsOnSignup: { type: Number, default: 0 },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // --- Legacy fields ---
    name: {
      type: String,
      required: true,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
    },
    duration: {
      type: Number,
      required: true,
    },
    access: {
      type: String,
      enum: ["quiz", "course", "duration", "default"],
      default: "default",
    },
    isUpgradable: {
      type: Boolean,
      default: false,
    },
    numberOfQuizzes: {
      type: Number,
      default: 0,
    },
    quizzes: {
      type: [Schema.Types.ObjectId],
      default: [],
    },
    numberOfCourses: {
      type: Number,
      default: 0,
    },
    courses: {
      type: [Schema.Types.ObjectId],
      default: [],
    },
    discountCode: {
      type: String,
      unique: true,
      sparse: true,
    },
    discountPercentage: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

PackageSchema.index({ tier: 1, durationType: 1 }, { sparse: true });

export const Package: Model<IPackage> = model<IPackage>(
  "Package",
  PackageSchema,
);

const PaymentSchema: Schema<IPayment> = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    reference: {
      type: String,
      required: true,
      unique: true,
    },
    date: {
      type: Date,
      required: true,
    },
    endsAt: {
      type: Schema.Types.Date,
      default: null,
    },
    isValid: {
      type: Boolean,
      required: true,
    },
    method: {
      type: String,
      enum: ["mobile_money", "card", "bank", "bank_transfer", "ussd", "qr", "eft", "free_tier", "paystack"],
      default: "mobile_money",
    },
    accessCode: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: [
        "abandoned",
        "failed",
        "ongoing",
        "pending",
        "processing",
        "queued",
        "success",
        "reversed",
      ],
      default: "pending",
    },
    type: {
      type: String,
      enum: ["course", "quiz", "duration", "credits", "default", "plan"],
      default: "default",
    },
    package: {
      type: Schema.Types.ObjectId,
      ref: "Package",
    },
    promoCode: {
      type: String,
      default: null,
    },
    creditsAdded: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

PaymentSchema.index({ userId: 1, status: 1 });

export const Payment: Model<IPayment> = model<IPayment>(
  "Payment",
  PaymentSchema,
);

const SubscriptionSchema = new Schema<ISubscription>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    packageId: {
      type: Schema.Types.ObjectId,
      ref: "Package",
      required: true,
    },
    paymentId: {
      type: Schema.Types.ObjectId,
      ref: "Payment",
    },
    status: {
      type: String,
      enum: ["active", "expired", "cancelled"],
      required: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    billingSummaryEmailSentAt: {
      type: Date,
      required: false,
    },
  },
  {
    timestamps: true,
  },
);

SubscriptionSchema.index({ userId: 1, packageId: 1, status: 1 });
SubscriptionSchema.index({ endDate: 1, billingSummaryEmailSentAt: 1 });

export const Subscription: Model<ISubscription> = model<ISubscription>(
  "Subscription",
  SubscriptionSchema,
);

const CreditBundleSchema = new Schema<ICreditBundle>(
  {
    name: {
      type: String,
      enum: ["starter", "standard", "max"],
      required: true,
      unique: true,
    },
    priceGHS: {
      type: Number,
      required: true,
    },
    credits: {
      type: Number,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

export const CreditBundle: Model<ICreditBundle> = model<ICreditBundle>(
  "CreditBundle",
  CreditBundleSchema,
);
