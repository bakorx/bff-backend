import { PlanTier, TierLimits, PlanDuration, FeatureKey } from "./interfaces";

// Feature limits per tier (base daily limits before duration multiplier)
export const TIER_LIMITS: Record<PlanTier, TierLimits> = {
  cooked: {
    tutorSessionsPerDay: 1,
    quizGenerationsPerDay: 2,
    flashcardSetsPerDay: 2,
    mindMapsPerDay: 1,
    materialUploadsPerDay: 1,
    pdfExport: false,
    analyticsLevel: "basic",
    priorityProcessing: false,
    earlyFeatureAccess: false,
    bonusCreditsOnSignup: 0,
  },
  cruising: {
    tutorSessionsPerDay: 3,
    quizGenerationsPerDay: 5,
    flashcardSetsPerDay: 5,
    mindMapsPerDay: 3,
    materialUploadsPerDay: 3,
    pdfExport: true,
    analyticsLevel: "full",
    priorityProcessing: false,
    earlyFeatureAccess: false,
    bonusCreditsOnSignup: 10,
  },
  locked_in: {
    tutorSessionsPerDay: null,
    quizGenerationsPerDay: null,
    flashcardSetsPerDay: null,
    mindMapsPerDay: null,
    materialUploadsPerDay: null,
    pdfExport: true,
    analyticsLevel: "full",
    priorityProcessing: true,
    earlyFeatureAccess: true,
    bonusCreditsOnSignup: 25,
  },
};

// Duration multipliers applied to base daily limits (longer = more per day)
export const DURATION_MULTIPLIERS: Record<PlanDuration, number> = {
  daily: 1.0,
  weekly: 1.25,
  semester: 1.75,
};

// Duration in days for subscription expiry calculation
export const DURATION_DAYS: Record<PlanDuration, number> = {
  daily: 1,
  weekly: 7,
  semester: 112, // 16 weeks
};

// Canonical GHS prices (pesewas * 100 when sending to Paystack)
export const PLAN_PRICES: Record<PlanTier, Record<PlanDuration, number>> = {
  cooked: { daily: 2.99, weekly: 4.99, semester: 14.99 },
  cruising: { daily: 3.99, weekly: 6.99, semester: 19.99 },
  locked_in: { daily: 4.99, weekly: 9.99, semester: 29.99 },
};

// Credit bundles (pay-as-you-go)
export const CREDIT_BUNDLES = [
  { name: "starter" as const, priceGHS: 3, credits: 30 },
  { name: "standard" as const, priceGHS: 9, credits: 100 },
  { name: "max" as const, priceGHS: 25, credits: 250 },
];

export type CreditBundleName = (typeof CREDIT_BUNDLES)[number]["name"];

// Credits deducted when a plan limit is exceeded (0 = hard block, no credit fallback)
export const CREDIT_COSTS: Record<FeatureKey, number> = {
  tutorSessions: 25,
  quizGenerations: 10,
  flashcardSets: 10,
  mindMaps: 5,
  materialUploads: 0, // hard blocked at limit — not credit-purchasable
};

// Maps FeatureKey to the TierLimits field for that feature
export const FEATURE_TO_LIMIT_KEY: Record<FeatureKey, keyof TierLimits> = {
  tutorSessions: "tutorSessionsPerDay",
  quizGenerations: "quizGenerationsPerDay",
  flashcardSets: "flashcardSetsPerDay",
  mindMaps: "mindMapsPerDay",
  materialUploads: "materialUploadsPerDay",
};

export const TIER_ORDER: PlanTier[] = ["cooked", "cruising", "locked_in"];