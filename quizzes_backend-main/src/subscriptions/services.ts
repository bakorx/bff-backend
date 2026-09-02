import { Types } from "mongoose";
import https from "https";
import crypto from "crypto";
import { Package, Payment, Subscription, CreditBundle } from "./models";
import { FeatureKey, IPackage, IPayment, ISubscription, PlanDuration, PlanTier, TierLimits } from "./interfaces";
import { runInTransaction } from "@/utils";
import { CONFIG } from "@/config";
import { User } from "@/users";
import {
  computeDiscount,
  awardReferralDiscount,
  incrementPromoUsage,
} from "./discount/services";
import { freezesForTier } from "./streak/services";
import { logger } from "@/config";
import { CREDIT_COSTS, DURATION_DAYS, DURATION_MULTIPLIERS, FEATURE_TO_LIMIT_KEY, TIER_LIMITS } from "./constants";


// ---------------------------------------------------------------------------
// Paystack API helpers
// ---------------------------------------------------------------------------

const PAYSTACK_BASE = "api.paystack.co";
const PAYSTACK_TXN_PATH = "/transaction";

function getPaystackSecretKey(): string {
  return CONFIG.ENV === "production"
    ? CONFIG.PAYSTACK_SECRET_KEY_LIVE
    : CONFIG.PAYSTACK_SECRET_KEY_TEST;
}

function paystackRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const options: https.RequestOptions = {
      hostname: PAYSTACK_BASE,
      port: 443,
      path,
      method,
      headers: {
        Authorization: `Bearer ${getPaystackSecretKey()}`,
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    };

    const req = https.request(
      options,
      (res: import("http").IncomingMessage) => {
        let data = "";
        res.on("data", (chunk: Buffer | string) => (data += chunk));
        res.on("end", () => {
          try {
            if (
              res.statusCode &&
              (res.statusCode < 200 || res.statusCode >= 300)
            ) {
              // For 4xx/5xx errors, Paystack usually returns JSON with a message
              try {
                const errorParsed = JSON.parse(data) as {
                  status: boolean;
                  message: string;
                };
                reject(
                  new Error(
                    errorParsed.message ||
                      `Paystack request failed with status ${res.statusCode}`,
                  ),
                );
              } catch {
                reject(
                  new Error(
                    `Paystack request failed with status ${res.statusCode}: ${data.substring(0, 100)}`,
                  ),
                );
              }
              return;
            }

            const parsed = JSON.parse(data) as {
              status: boolean;
              message: string;
              data: T;
            };
            if (!parsed.status) {
              reject(new Error(parsed.message || "Paystack request failed"));
            } else {
              resolve(parsed.data);
            }
          } catch (err) {
            logger.error(
              "Paystack Response Parse Error. Response content:",
              data,
            );
            reject(new Error("Failed to parse Paystack response"));
          }
        });
      },
    );

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export interface PaystackInitResult {
  authorization_url: string;
  access_code: string;
  reference: string;
}

export interface PaystackVerifyResult {
  id: number;
  status: string;
  reference: string;
  amount: number;
  currency: string;
  paid_at: string;
  channel: string;
  metadata: Record<string, unknown>;
  customer: { email: string; id: number };
  authorization: { authorization_code: string };
}

/**
 * Initializes a Paystack transaction and returns the authorization URL,
 * access code, and reference.
 *
 * @param email       Customer email.
 * @param amountKobo  Amount in the smallest currency unit (kobo/pesewas).
 * @param reference   Unique transaction reference you generate.
 * @param metadata    Arbitrary key/value pairs forwarded to Paystack.
 * @param callbackUrl Optional redirect URL after payment.
 */
export async function initializeTransaction(
  email: string,
  amountKobo: number,
  reference: string,
  metadata?: Record<string, unknown>,
  callbackUrl?: string,
): Promise<PaystackInitResult> {
  return paystackRequest<PaystackInitResult>(
    "POST",
    `${PAYSTACK_TXN_PATH}/initialize`,
    {
      email,
      amount: amountKobo,
      reference,
      ...(metadata ? { metadata } : {}),
      ...(callbackUrl ? { callback_url: callbackUrl } : {}),
    },
  );
}

/**
 * Verifies a Paystack transaction by its reference.
 */
export async function verifyTransaction(
  reference: string,
): Promise<PaystackVerifyResult> {
  return paystackRequest<PaystackVerifyResult>(
    "GET",
    `${PAYSTACK_TXN_PATH}/verify/${encodeURIComponent(reference)}`,
  );
}

/**
 * Validates the `x-paystack-signature` HMAC header from a webhook request.
 * The route must use `express.raw()` so the raw bytes are preserved.
 */
export function validateWebhookSignature(
  rawBody: Buffer,
  signature: string,
): boolean {
  // Reject obviously invalid signatures before the HMAC comparison
  if (!signature || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  const expected = crypto
    .createHmac("sha512", getPaystackSecretKey())
    .update(rawBody)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(signature, "hex"),
  );
}

/**
 * Parses the Paystack webhook payload.
 * Only call this after `validateWebhookSignature` returns true.
 */
export function parseWebhookEvent(rawBody: Buffer): {
  event: string;
  data: Record<string, unknown>;
} {
  return JSON.parse(rawBody.toString("utf8"));
}

// --- PACKAGE SERVICES ---
export const createPackage = async (data: Partial<IPackage>) => {
  return await runInTransaction(async (session) => {
    const pkg = new Package(data);
    return await pkg.save({ session });
  });
};

export const updatePackage = async (
  id: string | Types.ObjectId,
  data: Partial<IPackage>,
) => {
  return await runInTransaction(async (session) => {
    return await Package.findByIdAndUpdate(id, data, {
      returnDocument: "after",
      session,
    });
  });
};

export const deletePackage = async (id: string | Types.ObjectId) => {
  return await runInTransaction(async (session) => {
    return await Package.findByIdAndDelete(id, { session });
  });
};

// --- PAYMENT SERVICES ---
export const createPayment = async (data: Partial<IPayment>) => {
  return await runInTransaction(async (session) => {
    const payment = new Payment(data);
    return await payment.save({ session });
  });
};

export const updatePayment = async (
  id: string | Types.ObjectId,
  data: Partial<IPayment>,
) => {
  return await runInTransaction(async (session) => {
    return await Payment.findByIdAndUpdate(id, data, {
      returnDocument: "after",
      session,
    });
  });
};

export const deletePayment = async (id: string | Types.ObjectId) => {
  return await runInTransaction(async (session) => {
    return await Payment.findByIdAndDelete(id, { session });
  });
};

/**
 * Updates payment status by Mongo _id (legacy helper).
 * @deprecated Prefer `confirmPayment` or `updatePaymentByReference` for Paystack flows.
 */
export const updatePaymentStatus = async (
  idOrReference: string | Types.ObjectId,
  status: string,
) => {
  return await runInTransaction(async (session) => {
    // Try by reference first (Paystack webhook / verify path), then by _id
    const byRef = await Payment.findOneAndUpdate(
      { reference: String(idOrReference) },
      { status },
      { returnDocument: "after", session },
    );
    if (byRef) return byRef;
    return await Payment.findByIdAndUpdate(
      idOrReference,
      { status },
      { returnDocument: "after", session },
    );
  });
};

/**
 * Marks a payment as successful after Paystack verification, then creates or
 * activates the corresponding subscription (for plan payments) or tops up credits
 * (for credit bundle payments) in the same transaction.
 */
export const confirmPayment = async (
  reference: string,
  paystackData: PaystackVerifyResult,
) => {
  return await runInTransaction(async (session) => {
    const payment = await Payment.findOneAndUpdate(
      { reference },
      {
        status: "success",
        isValid: true,
        method: paystackData.channel ?? "paystack",
      },
      { returnDocument: "after", session },
    );

    if (!payment) return null;

    // --- Increment promo usage if applicable ---
    if ((payment as any).promoCode) {
      await incrementPromoUsage((payment as any).promoCode, session);
    }

    // --- Credits purchase ---
    if (payment.type === "credits") {
      await confirmCreditPurchaseInSession(payment, session);
      return payment;
    }

    // --- Plan subscription ---
    const pkg = await Package.findById(payment.package).session(session).lean();
    const durationDays = pkg?.durationType
      ? DURATION_DAYS[pkg.durationType as keyof typeof DURATION_DAYS]
      : (pkg?.duration ?? 30);
    const now = new Date();
    const endDate = new Date(
      now.getTime() + durationDays * 24 * 60 * 60 * 1000,
    );

    const existing = await Subscription.findOne({
      userId: payment.userId,
      packageId: payment.package,
      status: "active",
    }).session(session);

    if (existing) {
      existing.endDate = new Date(
        Math.max(existing.endDate.getTime(), now.getTime()) +
          durationDays * 24 * 60 * 60 * 1000,
      );
      await existing.save({ session });
    } else {
      await new Subscription({
        userId: payment.userId,
        packageId: payment.package,
        paymentId: payment._id,
        status: "active",
        startDate: now,
        endDate,
      }).save({ session });
    }

    // Set planTier + planDuration on user, award signup bonus credits if first plan
    if (pkg?.tier && pkg?.durationType) {
      const tier = pkg.tier as string;
      const durationType = pkg.durationType as string;
      const bonusCredits =
        TIER_LIMITS[tier as keyof typeof TIER_LIMITS]?.bonusCreditsOnSignup ??
        0;

      // Check if this is the user's first ever successful plan payment
      const previousPlanPayments = await Payment.countDocuments({
        userId: payment.userId,
        type: { $ne: "credits" },
        status: "success",
        _id: { $ne: payment._id },
      }).session(session);

      const isFirstPlan = previousPlanPayments === 0;

      const freezes = freezesForTier(tier);

      await User.updateOne(
        { _id: payment.userId },
        {
          $set: {
            planTier: tier,
            planDuration: durationType,
            isSubscribed: true,
            ...(freezes > 0 ? { "streak.freezesAvailable": freezes } : {}),
          },
          ...(isFirstPlan && bonusCredits > 0
            ? {
                $inc: {
                  "credits.balance": bonusCredits,
                  "credits.lifetimeEarned": bonusCredits,
                },
              }
            : {}),
        },
        { session },
      );

      // Award referral discount to referrer on first plan
      if (isFirstPlan) {
        const buyer = await User.findById(payment.userId)
          .select("referredBy")
          .session(session);
        if (buyer?.referredBy) {
          await awardReferralDiscount(String(buyer.referredBy), session);
        }
      }
    } else {
      // Legacy package — just mark subscribed
      await User.updateOne(
        { _id: payment.userId },
        { $set: { isSubscribed: true } },
        { session },
      );
    }

    return payment;
  });
};

/**
 * Handles the credits-purchase branch of confirmPayment.
 * Tops up user.credits.balance by the bundle amount.
 * Called from within an existing transaction session.
 */
async function confirmCreditPurchaseInSession(
  payment: IPayment,
  session: import("mongoose").ClientSession,
): Promise<void> {
  const bundle = await CreditBundle.findById(payment.package)
    .session(session)
    .lean();
  if (!bundle) throw new Error("Credit bundle not found for payment");

  const creditsToAdd = bundle.credits;

  await User.updateOne(
    { _id: payment.userId },
    {
      $inc: {
        "credits.balance": creditsToAdd,
        "credits.lifetimeEarned": creditsToAdd,
      },
      $set: {
        "aiUsageStats.creditsRemaining": 0, // deprecated field — zero out to avoid confusion
      },
    },
    { session },
  );
}

/**
 * Initiates a credit bundle Paystack transaction.
 */
export const initiateCreditPayment = async (
  bundleId: string,
  userId: string,
  email: string,
  callbackUrl?: string,
) => {
  const bundle = await CreditBundle.findById(bundleId).lean();
  if (!bundle) throw new Error("Credit bundle not found");
  if (!bundle.isActive) throw new Error("Credit bundle is not available");

  const reference = `QZ-CREDITS-${Date.now()}-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;

  const paystackResult = await initializeTransaction(
    email,
    Math.round(bundle.priceGHS * 100),
    reference,
    { userId, bundleId, type: "credits" },
    callbackUrl,
  );

  const payment = await runInTransaction(async (session) => {
    return await new Payment({
      userId,
      amount: bundle.priceGHS,
      reference,
      date: new Date(),
      isValid: false,
      method: "paystack",
      accessCode: paystackResult.access_code,
      status: "pending",
      type: "credits",
      package: bundleId,
      creditsAdded: bundle.credits,
    }).save({ session });
  });

  return {
    payment,
    authorizationUrl: paystackResult.authorization_url,
    reference,
  };
};

// --- SUBSCRIPTION SERVICES ---
export const createSubscription = async (data: Partial<ISubscription>) => {
  return await runInTransaction(async (session) => {
    const subscription = new Subscription(data);
    return await subscription.save({ session });
  });
};

export const updateSubscription = async (
  id: string | Types.ObjectId,
  data: Partial<ISubscription>,
) => {
  return await runInTransaction(async (session) => {
    return await Subscription.findByIdAndUpdate(id, data, {
      returnDocument: "after",
      session,
    });
  });
};

export const deleteSubscription = async (id: string | Types.ObjectId) => {
  return await runInTransaction(async (session) => {
    return await Subscription.findByIdAndUpdate(
      id,
      { status: "cancelled" },
      { returnDocument: "after", session },
    );
  });
};

/**
 * Cancels subscriptions associated with a Paystack subscription code stored
 * in payment metadata.  Triggered by the `subscription.disable` webhook event.
 */
export const cancelSubscriptionByCode = async (subscriptionCode: string) => {
  return await runInTransaction(async (session) => {
    // The subscription code is stored on Payment.metadata.subscriptionCode
    const payment = await Payment.findOne({
      "metadata.subscriptionCode": subscriptionCode,
    })
      .session(session)
      .lean();
    if (!payment) return null;

    return await Subscription.updateMany(
      { paymentId: payment._id, status: "active" },
      { status: "cancelled" },
      { session },
    );
  });
};

/**
 * Ensures a user has a referral code. Generates one if it doesn't exist.
 */
export const getOrCreateReferralCode = async (
  userId: string | Types.ObjectId,
) => {
  return await runInTransaction(async (session) => {
    const user = await User.findById(userId).session(session);
    if (!user) throw new Error("User not found");

    if (user.referralCode) return user.referralCode;

    // Generate a unique 6-character short code
    let code = "";
    let isUnique = false;
    let attempts = 0;

    while (!isUnique && attempts < 5) {
      code = crypto.randomBytes(3).toString("hex").toUpperCase(); // 6 characters
      const existing = await User.findOne({ referralCode: code }).session(
        session,
      );
      if (!existing) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      // Fallback to a longer code if collisions persist (unlikely for 16M space)
      code = `Z${Date.now().toString(36).toUpperCase()}`;
    }

    user.referralCode = code;
    await user.save({ session });

    return code;
  });
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns UTC midnight for today */
function todayUTC(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

// Maps FeatureKey to the dailyUsage counter field name on IUser
const FEATURE_TO_COUNTER: Record<FeatureKey, string> = {
  tutorSessions: "dailyUsage.tutorSessions",
  quizGenerations: "dailyUsage.quizGenerations",
  flashcardSets: "dailyUsage.flashcardSets",
  mindMaps: "dailyUsage.mindMaps",
  materialUploads: "dailyUsage.materialUploads",
};

const FEATURE_TO_USAGE_KEY: Record<
  FeatureKey,
  keyof typeof blankDailyCounters
> = {
  tutorSessions: "tutorSessions",
  quizGenerations: "quizGenerations",
  flashcardSets: "flashcardSets",
  mindMaps: "mindMaps",
  materialUploads: "materialUploads",
};

const blankDailyCounters = {
  tutorSessions: 0,
  quizGenerations: 0,
  flashcardSets: 0,
  mindMaps: 0,
  materialUploads: 0,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsageCheckResult {
  allowed: boolean;
  remaining: number | null; // null = unlimited
  source: "plan" | "credits" | "free_tier" | "blocked";
  creditsDeducted?: number;
}

export function evaluateAllowanceDecision(params: {
  limit: number | null;
  currentCount: number;
  creditCost: number;
  creditBalance: number;
  source: "plan" | "free_tier";
}): UsageCheckResult {
  const { limit, currentCount, creditCost, creditBalance, source } = params;
  if (limit === null) {
    return { allowed: true, remaining: null, source };
  }

  if (currentCount < limit) {
    return {
      allowed: true,
      remaining: limit - currentCount,
      source,
    };
  }

  if (creditCost > 0 && creditBalance >= creditCost) {
    return {
      allowed: true,
      remaining: 0,
      source: "credits",
      creditsDeducted: creditCost,
    };
  }

  return { allowed: false, remaining: 0, source: "blocked" };
}

type UsageContext = {
  source: "plan" | "free_tier";
  limit: number | null;
  currentCount: number;
  usageKey: keyof typeof blankDailyCounters;
  counterPath: string;
  today: Date;
};

// ---------------------------------------------------------------------------
// Core service
// ---------------------------------------------------------------------------

/**
 * Read-only precheck for usage allowance.
 */
export async function checkUsageAllowance(
  userId: string | Types.ObjectId,
  feature: FeatureKey,
): Promise<UsageCheckResult> {
  return runInTransaction(async (session) => {
    const user = await User.findById(userId).session(session);
    if (!user) throw new Error("User not found");

    const context = await buildUsageContext(user, feature, session);

    return evaluateAllowanceDecision({
      limit: context.limit,
      currentCount: context.currentCount,
      creditCost: CREDIT_COSTS[feature],
      creditBalance: user.credits?.balance ?? 0,
      source: context.source,
    });
  });
}

/**
 * Atomic post-success consumption.
 */
export async function consumeUsage(
  userId: string | Types.ObjectId,
  feature: FeatureKey,
): Promise<UsageCheckResult> {
  return runInTransaction(async (session) => {
    const user = await User.findById(userId).session(session);
    if (!user) throw new Error("User not found");

    const context = await buildUsageContext(user, feature, session, true);

    if (context.limit === null) {
      await User.updateOne(
        { _id: user._id },
        { $inc: { [context.counterPath]: 1 } },
        { session },
      );
      return { allowed: true, remaining: null, source: context.source };
    }

    // Attempt atomic consume from plan/free-tier allowance first.
    const consumedFromLimit = await User.updateOne(
      {
        _id: user._id,
        "dailyUsage.date": context.today,
        [context.counterPath]: { $lt: context.limit },
      },
      { $inc: { [context.counterPath]: 1 } },
      { session },
    );

    if (consumedFromLimit.modifiedCount > 0) {
      const nextCount = context.currentCount + 1;
      return {
        allowed: true,
        remaining: Math.max(0, context.limit - nextCount),
        source: context.source,
      };
    }

    // At limit (or race reached limit) => attempt credit fallback atomically.
    const creditCost = CREDIT_COSTS[feature];
    if (creditCost <= 0) {
      return { allowed: false, remaining: 0, source: "blocked" };
    }

    const consumedFromCredits = await User.updateOne(
      {
        _id: user._id,
        "credits.balance": { $gte: creditCost },
      },
      {
        $inc: {
          [context.counterPath]: 1,
          "credits.balance": -creditCost,
        },
      },
      { session },
    );

    if (consumedFromCredits.modifiedCount > 0) {
      return {
        allowed: true,
        remaining: 0,
        source: "credits",
        creditsDeducted: creditCost,
      };
    }

    return { allowed: false, remaining: 0, source: "blocked" };
  });
}

async function buildUsageContext(
  user: any,
  feature: FeatureKey,
  session: any,
  resetIfStale = false,
): Promise<UsageContext> {
  const today = todayUTC();
  const usageDate = user.dailyUsage?.date ?? new Date(0);
  const hasTodayUsage = isSameDay(usageDate, today);

  if (resetIfStale && !hasTodayUsage) {
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          "dailyUsage.date": today,
          "dailyUsage.tutorSessions": 0,
          "dailyUsage.quizGenerations": 0,
          "dailyUsage.flashcardSets": 0,
          "dailyUsage.mindMaps": 0,
          "dailyUsage.materialUploads": 0,
        },
      },
      { session },
    );
  }

  const entitlement = await resolveEntitlement(user._id, user, session);
  let limit: number | null;
  if (
    entitlement.source === "plan" &&
    entitlement.tier &&
    entitlement.duration
  ) {
    limit = getEffectiveDailyLimit(
      entitlement.tier,
      entitlement.duration,
      feature,
    );
  } else {
    const freeLimits = getFreeTierLimits();
    const limitKey = featureToLimitKey(feature);
    limit = freeLimits[limitKey] as number | null;
  }

  const usageKey = FEATURE_TO_USAGE_KEY[feature];
  const currentCount = hasTodayUsage ? (user.dailyUsage?.[usageKey] ?? 0) : 0;

  return {
    source: entitlement.source,
    limit,
    currentCount,
    usageKey,
    counterPath: FEATURE_TO_COUNTER[feature],
    today,
  };
}

async function resolveEntitlement(
  userId: Types.ObjectId,
  userDoc: any,
  session: any,
): Promise<{
  source: "plan" | "free_tier";
  tier: PlanTier | null;
  duration: PlanDuration | null;
}> {
  const now = new Date();
  const activeSubscription = await Subscription.findOne({
    userId,
    status: "active",
    endDate: { $gt: now },
  })
    .sort({ endDate: -1 })
    .populate("packageId", "tier durationType")
    .session(session)
    .lean();

  const pkg = activeSubscription?.packageId as
    { tier?: string | null; durationType?: string | null } | undefined;

  if (
    pkg?.tier &&
    pkg?.durationType &&
    isPlanTier(pkg.tier) &&
    isPlanDuration(pkg.durationType)
  ) {
    return { source: "plan", tier: pkg.tier, duration: pkg.durationType };
  }

  // Legacy fallback for active plan users where package metadata may be incomplete.
  if (
    activeSubscription &&
    isPlanTier(userDoc.planTier) &&
    isPlanDuration(userDoc.planDuration)
  ) {
    return {
      source: "plan",
      tier: userDoc.planTier as PlanTier,
      duration: userDoc.planDuration as PlanDuration,
    };
  }

  return { source: "free_tier", tier: null, duration: null };
}

function isPlanTier(value: unknown): value is PlanTier {
  return value === "cooked" || value === "cruising" || value === "locked_in";
}

function isPlanDuration(value: unknown): value is PlanDuration {
  return value === "daily" || value === "weekly" || value === "semester";
}

/**
 * Backward-compatible alias for existing call sites.
 * New code should call `checkUsageAllowance` + `consumeUsage`.
 */
export async function checkAndIncrementUsage(
  userId: string | Types.ObjectId,
  feature: FeatureKey,
): Promise<UsageCheckResult> {
  return consumeUsage(userId, feature);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type LimitKey = keyof TierLimits;

function featureToLimitKey(feature: FeatureKey): LimitKey {
  const map: Record<FeatureKey, LimitKey> = {
    tutorSessions: "tutorSessionsPerDay",
    quizGenerations: "quizGenerationsPerDay",
    flashcardSets: "flashcardSetsPerDay",
    mindMaps: "mindMapsPerDay",
    materialUploads: "materialUploadsPerDay",
  };
  return map[feature];
}

/**
 * Returns the effective daily limit for a feature given tier + duration.
 * Applies the duration multiplier and rounds up. Returns null for unlimited.
 */
export function getEffectiveDailyLimit(
  tier: PlanTier,
  duration: PlanDuration,
  feature: FeatureKey,
): number | null {
  const limitKey = FEATURE_TO_LIMIT_KEY[feature];
  const baseLimit = TIER_LIMITS[tier][limitKey] as number | null;
  if (baseLimit === null) return null;
  const multiplier = DURATION_MULTIPLIERS[duration];
  return Math.ceil(baseLimit * multiplier);
}

/**
 * Returns the free-tier limits (same as cooked/daily — no duration bonus).
 * Applied to users with no active plan.
 */
export function getFreeTierLimits(): TierLimits {
  return TIER_LIMITS.cooked;
}



