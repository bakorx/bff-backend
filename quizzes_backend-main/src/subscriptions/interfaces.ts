import { Document, Types } from "mongoose";
import { CreditBundleName } from "./constants";
import { checkUsageAllowance } from "./services";

export interface IPackage extends Document {
  _id: Types.ObjectId;
  // --- New tier/duration fields ---
  tier: PlanTier;
  durationType: PlanDuration;
  priceGHS: number;
  limits: TierLimits;
  isActive: boolean;
  // --- Legacy fields (kept for backward compatibility) ---
  /** @deprecated Use priceGHS instead */
  price: number;
  name: string;
  /** @deprecated Use DURATION_DAYS[durationType] instead */
  duration: number;
  /** @deprecated Use tier instead */
  access: "quiz" | "course" | "duration" | "default";
  isUpgradable?: boolean;
  numberOfCourses?: number;
  courses?: Types.ObjectId[];
  numberOfQuizzes?: number;
  quizzes?: Types.ObjectId[];
  discountCode?: string;
  discountPercentage?: number;
}

export interface ICreditBundle extends Document {
  _id: Types.ObjectId;
  name: CreditBundleName;
  priceGHS: number;
  credits: number;
  isActive: boolean;
}

export interface IPayment extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  amount: number;
  reference: string;
  date: Date;
  endsAt?: Date;
  isValid: boolean;
  method:
    | "mobile_money"
    | "card"
    | "bank"
    | "bank_transfer"
    | "ussd"
    | "qr"
    | "eft"
    | "free_tier"
    | "paystack";
  accessCode: string;
  status:
    | "abandoned"
    | "failed"
    | "ongoing"
    | "pending"
    | "processing"
    | "queued"
    | "success"
    | "reversed";
  type: "course" | "quiz" | "duration" | "credits" | "default" | "plan";
  promoCode?: string;
  package: Types.ObjectId;
  creditsAdded?: number;
}

export interface ISubscription extends Document {
  userId: Types.ObjectId;
  packageId: Types.ObjectId;
  paymentId?: Types.ObjectId;
  status: "active" | "expired" | "cancelled";
  startDate: Date;
  endDate: Date;
  // Set once the end-of-cycle usage summary email has been sent for this
  // subscription, so the daily sweep never double-sends for the same cycle.
  billingSummaryEmailSentAt?: Date;
}

export type PlanTier = "cooked" | "cruising" | "locked_in";
export type PlanDuration = "daily" | "weekly" | "semester";
export type AnalyticsLevel = "basic" | "full";

export type FeatureKey =
  | "tutorSessions"
  | "quizGenerations"
  | "flashcardSets"
  | "mindMaps"
  | "materialUploads";

export interface TierLimits {
  tutorSessionsPerDay: number | null; // null = unlimited
  quizGenerationsPerDay: number | null;
  flashcardSetsPerDay: number | null;
  mindMapsPerDay: number | null;
  materialUploadsPerDay: number | null;
  pdfExport: boolean;
  analyticsLevel: AnalyticsLevel;
  priorityProcessing: boolean;
  earlyFeatureAccess: boolean;
  bonusCreditsOnSignup: number;
}

export type UsageChecker = typeof checkUsageAllowance;