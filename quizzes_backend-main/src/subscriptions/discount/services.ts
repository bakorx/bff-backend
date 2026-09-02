import { ClientSession } from "mongoose";
import { User } from "@/users";
import { PromoCode } from "./models";
import { Payment } from "../models";
import { DiscountApplication, DiscountResult } from "./interfaces";
import { UserCourseEnrollment } from "@/learning";
import { runInTransaction } from "@/utils";

const MAX_DISCOUNT_PERCENTAGE = 80;

interface ComputeDiscountInput {
  userId: string;
  originalAmountGHS: number;
  promoCode?: string;
  referralCode?: string;
  packageTier?: string;
  packageDuration?: string;
}

async function evaluatePromoEligibility(
  code: any,
  user: any,
  input: ComputeDiscountInput,
  session: ClientSession,
): Promise<{ eligible: boolean; reason?: string }> {
  const now = new Date();
  const eligibility = code.eligibility || {};

  if (eligibility.minOrderAmountGHS != null) {
    if (input.originalAmountGHS < Number(eligibility.minOrderAmountGHS)) {
      return {
        eligible: false,
        reason: `Minimum order is GHS ${eligibility.minOrderAmountGHS}`,
      };
    }
  }

  if (eligibility.maxOrderAmountGHS != null) {
    if (input.originalAmountGHS > Number(eligibility.maxOrderAmountGHS)) {
      return {
        eligible: false,
        reason: `Maximum order is GHS ${eligibility.maxOrderAmountGHS}`,
      };
    }
  }

  if (eligibility.includeTiers?.length) {
    if (
      !input.packageTier ||
      !eligibility.includeTiers.includes(input.packageTier)
    ) {
      return { eligible: false, reason: "Promo not valid for this plan tier" };
    }
  }

  if (eligibility.includeDurations?.length) {
    if (
      !input.packageDuration ||
      !eligibility.includeDurations.includes(input.packageDuration)
    ) {
      return {
        eligible: false,
        reason: "Promo not valid for this plan duration",
      };
    }
  }

  const successfulPayments = await Payment.countDocuments({
    userId: user._id,
    status: "success",
  }).session(session);

  if (eligibility.newUsersOnly && successfulPayments > 0) {
    return { eligible: false, reason: "Promo is for new users only" };
  }

  if (eligibility.firstPurchaseOnly && successfulPayments > 0) {
    return { eligible: false, reason: "Promo applies only to first purchase" };
  }

  if (eligibility.maxUsesPerUser != null) {
    const userUsage = await Payment.countDocuments({
      userId: user._id,
      status: "success",
      promoCode: code.code,
    }).session(session);
    if (userUsage >= Number(eligibility.maxUsesPerUser)) {
      return { eligible: false, reason: "Per-user promo usage limit reached" };
    }
  }

  const includeCourseIds: string[] = (eligibility.includeCourseIds || []).map(
    (id: any) => String(id),
  );
  if (includeCourseIds.length > 0) {
    const enrolled = await UserCourseEnrollment.find({ userId: user._id })
      .select("courseId")
      .lean()
      .session(session);
    const enrolledIds = new Set(enrolled.map((e: any) => String(e.courseId)));

    const hasAll = includeCourseIds.every((id) => enrolledIds.has(id));
    const hasAny = includeCourseIds.some((id) => enrolledIds.has(id));
    const passes = eligibility.requireAllCourseIds ? hasAll : hasAny;

    if (!passes) {
      return {
        eligible: false,
        reason: eligibility.requireAllCourseIds
          ? "You are not enrolled in all required courses"
          : "You are not enrolled in an eligible course",
      };
    }
  }

  const streakCount = user.streak?.currentCount ?? 0;
  if ((eligibility.minStreakDays || 0) > streakCount) {
    return {
      eligible: false,
      reason: `Requires at least ${eligibility.minStreakDays} streak days`,
    };
  }

  if (eligibility.hasPendingReferralReward && !user.pendingReferralDiscount) {
    return {
      eligible: false,
      reason: "Requires pending referral reward",
    };
  }

  if (eligibility.hasCompletedOnboarding && !user.onboarding?.completed) {
    return {
      eligible: false,
      reason: "Complete onboarding to use this promo",
    };
  }

  if (eligibility.inactiveForDays != null) {
    const lastActive = user.lastLogin || user.updatedAt || user.createdAt;
    const cutoff = new Date(
      now.getTime() - Number(eligibility.inactiveForDays) * 24 * 60 * 60 * 1000,
    );
    if (!lastActive || new Date(lastActive) > cutoff) {
      return {
        eligible: false,
        reason: `Promo requires ${eligibility.inactiveForDays}+ days inactivity`,
      };
    }
  }

  if (eligibility.firstNDaysAfterSignup != null) {
    const ageMs = now.getTime() - new Date(user.createdAt).getTime();
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    if (ageDays > Number(eligibility.firstNDaysAfterSignup)) {
      return {
        eligible: false,
        reason: `Promo valid only within first ${eligibility.firstNDaysAfterSignup} days`,
      };
    }
  }

  return { eligible: true };
}

/**
 * Computes all applicable discounts for a user's purchase.
 * Must be called inside an existing transaction — pass the session in.
 * Does NOT commit. The caller owns the transaction.
 */
export async function computeDiscount(
  input: ComputeDiscountInput,
  session: ClientSession,
): Promise<DiscountResult> {
  const {
    userId,
    originalAmountGHS,
    promoCode,
    referralCode,
    packageDuration,
    packageTier,
  } = input;

  const user = await User.findById(userId).session(session);
  if (!user) throw new Error("User not found");

  const discounts: DiscountApplication[] = [];
  let promoCodeCheck: DiscountResult["promoCodeCheck"];

  // 1. Promo code
  if (promoCode) {
    const code = await PromoCode.findOne({
      code: promoCode.toUpperCase(),
      isActive: true,
    }).session(session);

    if (code) {
      const now = new Date();
      const notExpired = !code.expiresAt || code.expiresAt > now;
      const hasUses = code.maxUses === null || code.usedCount < code.maxUses;

      if (notExpired && hasUses) {
        const eligibilityCheck = await evaluatePromoEligibility(
          code,
          user,
          {
            userId,
            originalAmountGHS,
            promoCode,
            referralCode,
            packageDuration,
            packageTier,
          },
          session,
        );

        if (eligibilityCheck.eligible) {
          let percentage: number;
          if (code.type === "percentage") {
            percentage = Math.round(code.value);
          } else {
            percentage = Math.round(Math.min((code.value / originalAmountGHS) * 100, 100));
          }
          discounts.push({
            type: "promo",
            label: `Promo: ${code.code}`,
            percentage,
          });
          promoCodeCheck = { code: code.code, valid: true };
        } else {
          promoCodeCheck = {
            code: code.code,
            valid: false,
            reason: eligibilityCheck.reason,
          };
        }
      } else {
        promoCodeCheck = {
          code: code.code,
          valid: false,
          reason: notExpired
            ? "Promo usage limit reached"
            : "Promo has expired",
        };
      }
    } else {
      promoCodeCheck = {
        code: promoCode.toUpperCase(),
        valid: false,
        reason: "Invalid promo code",
      };
    }
  }

  // 2. Student discount (10% while verified)
  if (user.studentVerification?.status === "verified") {
    discounts.push({
      type: "student",
      label: "Student discount",
      percentage: 10,
    });
  }

  // 3. Referral Signup Discount (15% for new buyers)
  const currentReferralCode = referralCode || null;
  const isReferred = !!user.referredBy || !!currentReferralCode;

  if (isReferred) {
    // Check if valid code provided in input (if applicable)
    let validCode = true;
    if (currentReferralCode) {
      const referrerExists = await User.exists({
        referralCode: currentReferralCode,
      }).session(session);
      if (!referrerExists) validCode = false;
    }

    // Self-referral check — user cannot use their own referral code
    if (currentReferralCode) {
      const isSelfReferral = await User.exists({
        _id: userId,
        referralCode: currentReferralCode,
      }).session(session);
      if (isSelfReferral) validCode = false;
    }

    if (validCode) {
      // Must be first purchase
      const successfulPayments = await Payment.countDocuments({
        userId,
        status: "success",
      }).session(session);

      if (successfulPayments === 0) {
        discounts.push({
          type: "referral",
          label: "Referral signup",
          percentage: 15,
        });
      }
    }
  }

  // 4. Referral reward (15% off next renewal for REFERRERS)
  if (user.pendingReferralDiscount) {
    discounts.push({
      type: "referral",
      label: "Referral reward",
      percentage: 15,
    });
    // Clear the flag within this transaction
    await User.updateOne(
      { _id: user._id },
      { $set: { pendingReferralDiscount: false } },
      { session },
    );
  }

  // 4. Loyalty / streak discount
  const streakCount = user.streak?.currentCount ?? 0;
  const permanentPct = user.loyaltyDiscount?.permanentPercentage ?? 0;

  // Special case: 60–89 day streak + weekly plan = free week (100% off), one per term
  if (
    streakCount >= 60 &&
    streakCount < 90 &&
    packageDuration === "weekly" &&
    !user.streak?.restoreUsedThisTerm
  ) {
    discounts.push({
      type: "loyalty",
      label: "Streak reward: free week",
      percentage: 100,
    });
    await User.updateOne(
      { _id: user._id },
      { $set: { "streak.restoreUsedThisTerm": true } },
      { session },
    );
  } else {
    // Standard streak tiers
    let streakPct = 0;
    if (streakCount >= 90) {
      streakPct = permanentPct > 0 ? permanentPct : 15;
    } else if (streakCount >= 60) {
      streakPct = 30;
    } else if (streakCount >= 30) {
      streakPct = 20;
    } else if (streakCount >= 7) {
      streakPct = 10;
    }

    // Use whichever is higher: streak-based or permanent loyalty
    const effectivePct = Math.max(streakPct, permanentPct);
    if (effectivePct > 0) {
      discounts.push({
        type: "loyalty",
        label: `Streak loyalty (${streakCount} days)`,
        percentage: effectivePct,
      });
    }
  }

  // Sum and cap at MAX_DISCOUNT_PERCENTAGE (unless free-week 100% or explicit 100% promo)
  const hasFreeWeek = discounts.some(
    (d) => d.type === "loyalty" && d.label.includes("free week"),
  );
  const has100PercentPromo = discounts.some(
    (d) => d.type === "promo" && d.percentage >= 100,
  );

  let totalDiscountPercentage: number;
  if (hasFreeWeek || has100PercentPromo) {
    totalDiscountPercentage = 100;
  } else {
    const rawTotal = discounts.reduce((sum, d) => sum + d.percentage, 0);
    totalDiscountPercentage = Math.round(Math.min(rawTotal, MAX_DISCOUNT_PERCENTAGE));
  }

  const finalAmountGHS = Math.max(
    0,
    parseFloat(
      (originalAmountGHS * (1 - totalDiscountPercentage / 100)).toFixed(2),
    ),
  );

  return {
    finalAmountGHS,
    originalAmountGHS,
    discounts,
    totalDiscountPercentage,
    promoCodeCheck,
  };
}

/**
 * Preview discount without modifying DB — for checkout UI display.
 * Safe to call without a transaction.
 */
export async function previewDiscount(
  input: ComputeDiscountInput,
): Promise<DiscountResult> {
  return runInTransaction(async (session) => {
    // We run inside a transaction then abort implicitly via the preview pattern.
    // We need to undo the promo usedCount increment — so we use a read-only path.
    const {
      userId,
      originalAmountGHS,
      promoCode,
      referralCode,
      packageDuration,
      packageTier,
    } = input;

    const user = await User.findById(userId).session(session);
    if (!user) throw new Error("User not found");

    const discounts: DiscountApplication[] = [];
    let promoCodeCheck: DiscountResult["promoCodeCheck"];

    if (promoCode) {
      const code = await PromoCode.findOne({
        code: promoCode.toUpperCase(),
        isActive: true,
      }).session(session);

      if (code) {
        const now = new Date();
        const notExpired = !code.expiresAt || code.expiresAt > now;
        const hasUses = code.maxUses === null || code.usedCount < code.maxUses;
        if (notExpired && hasUses) {
          const eligibilityCheck = await evaluatePromoEligibility(
            code,
            user,
            {
              userId,
              originalAmountGHS,
              promoCode,
              referralCode,
              packageDuration,
              packageTier,
            },
            session,
          );
          if (eligibilityCheck.eligible) {
            const percentage =
              code.type === "percentage"
                ? Math.round(code.value)
                : Math.round(Math.min((code.value / originalAmountGHS) * 100, 100));
            discounts.push({
              type: "promo",
              label: `Promo: ${code.code}`,
              percentage,
            });
            promoCodeCheck = { code: code.code, valid: true };
          } else {
            promoCodeCheck = {
              code: code.code,
              valid: false,
              reason: eligibilityCheck.reason,
            };
          }
        } else {
          promoCodeCheck = {
            code: code.code,
            valid: false,
            reason: notExpired
              ? "Promo usage limit reached"
              : "Promo has expired",
          };
        }
      } else {
        promoCodeCheck = {
          code: promoCode.toUpperCase(),
          valid: false,
          reason: "Invalid promo code",
        };
      }
    }

    if (user.studentVerification?.status === "verified") {
      discounts.push({
        type: "student",
        label: "Student discount",
        percentage: 10,
      });
    }

    // Referral Signup Discount preview
    const currentReferralCode = referralCode || null;
    const isReferred = !!user.referredBy || !!currentReferralCode;

    if (isReferred) {
      let validCode = true;
      if (currentReferralCode) {
        const referrerExists = await User.exists({
          referralCode: currentReferralCode,
        }).session(session);
        if (!referrerExists) validCode = false;

        // Self-referral check
        if (validCode) {
          const isSelfReferral = await User.exists({
            _id: userId,
            referralCode: currentReferralCode,
          }).session(session);
          if (isSelfReferral) validCode = false;
        }
      }

      if (validCode) {
        const successfulPayments = await Payment.countDocuments({
          userId,
          status: "success",
        }).session(session);

        if (successfulPayments === 0) {
          discounts.push({
            type: "referral",
            label: "Referral signup",
            percentage: 15,
          });
        }
      }
    }

    if (user.pendingReferralDiscount) {
      discounts.push({
        type: "referral",
        label: "Referral reward",
        percentage: 15,
      });
    }

    const streakCount = user.streak?.currentCount ?? 0;
    const permanentPct = user.loyaltyDiscount?.permanentPercentage ?? 0;

    if (
      streakCount >= 60 &&
      streakCount < 90 &&
      packageDuration === "weekly" &&
      !user.streak?.restoreUsedThisTerm
    ) {
      discounts.push({
        type: "loyalty",
        label: "Streak reward: free week",
        percentage: 100,
      });
    } else {
      let streakPct = 0;
      if (streakCount >= 90) streakPct = permanentPct > 0 ? permanentPct : 15;
      else if (streakCount >= 60) streakPct = 30;
      else if (streakCount >= 30) streakPct = 20;
      else if (streakCount >= 7) streakPct = 10;
      const effectivePct = Math.max(streakPct, permanentPct);
      if (effectivePct > 0) {
        discounts.push({
          type: "loyalty",
          label: `Streak loyalty (${streakCount} days)`,
          percentage: effectivePct,
        });
      }
    }

    const hasFreeWeek = discounts.some(
      (d) => d.type === "loyalty" && d.label.includes("free week"),
    );
    const has100PercentPromo = discounts.some(
      (d) => d.type === "promo" && d.percentage >= 100,
    );
    const rawTotal = discounts.reduce((sum, d) => sum + d.percentage, 0);
    const totalDiscountPercentage =
      hasFreeWeek || has100PercentPromo
        ? 100
        : Math.round(Math.min(rawTotal, MAX_DISCOUNT_PERCENTAGE));
    const finalAmountGHS = Math.max(
      0,
      parseFloat(
        (originalAmountGHS * (1 - totalDiscountPercentage / 100)).toFixed(2),
      ),
    );

    // Throw to abort transaction — no writes happened in preview
    throw {
      __preview: true,
      result: {
        finalAmountGHS,
        originalAmountGHS,
        discounts,
        totalDiscountPercentage,
        promoCodeCheck,
      },
    };
  }).catch((err: any) => {
    if (err.__preview) return err.result as DiscountResult;
    throw err;
  });
}

/**
 * Awards referral discount to the referrer when a referred user completes their
 * first paid subscription. Call this from confirmPayment on first plan purchase.
 */
export async function awardReferralDiscount(
  referrerId: string,
  session: ClientSession,
): Promise<void> {
  await User.updateOne(
    { _id: referrerId },
    { $set: { pendingReferralDiscount: true } },
    { session },
  );
}

/**
 * Increment promo usage atomically.
 * Should only be called after a successful payment confirmation.
 */
export async function incrementPromoUsage(
  codeStr: string,
  session: ClientSession,
): Promise<void> {
  await PromoCode.updateOne(
    { code: codeStr.toUpperCase() },
    { $inc: { usedCount: 1 } },
    { session },
  );
}
