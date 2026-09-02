import { Request, Response } from "express";
import crypto from "crypto";
import * as services from "./services";
import * as selectors from "./selectors";
import { sendSuccess, sendError, getPaginatedMetadata } from "@/utils";
import { shortQueue } from "@/schedulers";
import { CreditBundle, Payment, Subscription } from "./models";
import { User } from "@/users";
import { CONFIG } from "@/config";
import { previewDiscount } from "./discount/services";
import { confirmDonation } from "@/donations";
import { logger } from "@/config";
import { TIER_LIMITS } from "./constants";

// --- SUBSCRIPTIONS DOMAIN CONTROLLERS ---

export const getPackages = async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const options = {
      isActive: true,
      sortBy: "priceGHS",
      sortOrder: "asc" as const,
      ...req.query,
    };
    const isActiveFilter = String(options.isActive) !== "false";
    const [packages, total] = await Promise.all([
      selectors.getAllPackages(options),
      selectors.countAllPackages({ isActive: isActiveFilter }),
    ]);
    const pagination = getPaginatedMetadata(total, Number(page), Number(limit));
    sendSuccess(res, "Packages retrieved successfully", packages, pagination);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getPackage = async (req: Request, res: Response) => {
  try {
    const pkg = await selectors.getPackageById(req.params.id as string);
    if (!pkg) return sendError(res, "Package not found", 404);
    sendSuccess(res, "Package retrieved successfully", pkg);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const createPackage = async (req: Request, res: Response) => {
  try {
    const pkg = await services.createPackage(req.body);
    sendSuccess(res, "Package created successfully", pkg, null, 201);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const initiatePayment = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id ?? (req as any).user?._id;
    const { packageId, bundleId, type, promoCode, referralCode } = req.body;

    const userDoc = await User.findById(userId).select("email").lean();
    if (!userDoc?.email) return sendError(res, "User email not found", 400);
    const email = userDoc.email;

    let originalAmountGHS: number;
    let pkg: any = null;
    let bundle: any = null;

    if (type === "credits" || bundleId) {
      bundle = await CreditBundle.findById(bundleId).lean();
      if (!bundle) return sendError(res, "Credit bundle not found", 404);
      originalAmountGHS = bundle.priceGHS;
    } else {
      pkg = await selectors.getPackageById(packageId);
      if (!pkg) return sendError(res, "Package not found", 404);
      originalAmountGHS = pkg.priceGHS ?? pkg.price;
    }

    // Apply referral code to buyer profile (only on first payment attempt)
    if (referralCode) {
      const referrer = await User.findOne({ referralCode })
        .select("_id")
        .lean();
      if (referrer && String(referrer._id) !== String(userId)) {
        await User.updateOne(
          { _id: userId, referredBy: null },
          { $set: { referredBy: referrer._id } },
        );
      }
    }

    // Compute discount
    const discountResult = await previewDiscount({
      userId,
      originalAmountGHS,
      promoCode,
      referralCode,
      packageTier: pkg?.tier,
      packageDuration: pkg?.durationType,
    });

    const finalAmountGHS = discountResult.finalAmountGHS;
    const reference = `QZ-${Date.now()}-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
    const paymentType = type || (bundleId ? "credits" : "plan");
    const targetItemId = packageId || bundleId;

    if (finalAmountGHS === 0) {
      const payment = await services.createPayment({
        userId,
        amount: 0,
        reference,
        date: new Date(),
        isValid: true,
        method: "free_tier",
        accessCode: "FREE_TIER",
        status: "success",
        type: paymentType,
        package: targetItemId,
        creditsAdded: bundle ? bundle.credits : 0,
        promoCode: promoCode || null,
      });

      await services.confirmPayment(reference, {
        id: Date.now(),
        status: "success",
        reference,
        amount: 0,
        currency: "GHS",
        paid_at: new Date().toISOString(),
        channel: "system",
        metadata: { userId, packageId: targetItemId, type: paymentType, promoCode },
        customer: { email, id: Date.now() },
        authorization: { authorization_code: "SYSTEM_FREE" },
      });

      return sendSuccess(
        res,
        "Payment initiated and completed successfully",
        {
          payment,
          authorizationUrl: `${CONFIG.FRONTEND_URL}/payment/callback?reference=${reference}`,
          accessCode: "FREE_TIER",
          reference,
          discount: discountResult,
        },
        null,
        201,
      );
    }

    const paystackResult = await services.initializeTransaction(
      email,
      Math.round(finalAmountGHS * 100),
      reference,
      {
        userId,
        packageId: targetItemId,
        type: paymentType,
        promoCode,
        discountApplied: discountResult.totalDiscountPercentage,
      },
      `${CONFIG.FRONTEND_URL}/payment/callback`,
    );

    const payment = await services.createPayment({
      userId,
      amount: finalAmountGHS,
      reference,
      date: new Date(),
      isValid: false,
      method: "paystack",
      accessCode: paystackResult.access_code,
      status: "pending",
      type: paymentType,
      package: targetItemId,
      creditsAdded: bundle ? bundle.credits : 0,
      promoCode: promoCode || null,
    });

    sendSuccess(
      res,
      "Payment initiated",
      {
        payment,
        authorizationUrl: paystackResult.authorization_url,
        accessCode: paystackResult.access_code,
        reference: paystackResult.reference,
        discount: discountResult,
      },
      null,
      201,
    );
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const verifyPayment = async (req: Request, res: Response) => {
  try {
    const reference = String(req.params.reference);
    if (!reference) return sendError(res, "reference is required", 400);

    // 1. Check if the payment is natively successful already (e.g., 0 GHS system bypass)
    const existingPayment = await Payment.findOne({ reference }).lean();
    if (existingPayment?.status === "success") {
      return sendSuccess(
        res,
        "Payment verified and subscription activated natively",
        existingPayment,
      );
    }

    // 2. Verify external gateway against Paystack
    const paystackData = await services.verifyTransaction(reference);

    if (paystackData.status !== "success") {
      await services.updatePaymentStatus(reference, paystackData.status);
      return sendError(
        res,
        `Payment not successful: ${paystackData.status}`,
        402,
      );
    }

    // 3. Mark as successful and activate subscription
    const payment = await services.confirmPayment(reference, paystackData);

    // Enqueue payment confirmation email
    if (payment) {
      shortQueue.enqueue("email:payment_confirmation", {
        userId: payment.userId,
        reference,
        amount: paystackData.amount / 100,
        currency: paystackData.currency,
      });
    }

    sendSuccess(res, "Payment verified and subscription activated", payment);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getUserSubscriptions = async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const userId = req.params.userId as string;
    const [subscriptions, total] = await Promise.all([
      selectors.getSubscriptionsByUser(userId, req.query),
      selectors.countSubscriptionsByUser(userId),
    ]);
    const pagination = getPaginatedMetadata(total, Number(page), Number(limit));
    sendSuccess(
      res,
      "User subscriptions retrieved successfully",
      subscriptions,
      pagination,
    );
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getAllSubscriptions = async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const countFilter: Record<string, any> = {};
    if (status) countFilter.status = status;
    const [subscriptions, total] = await Promise.all([
      selectors.getAllSubscriptions(req.query),
      selectors.countAllSubscriptions(countFilter),
    ]);
    const pagination = getPaginatedMetadata(total, Number(page), Number(limit));
    sendSuccess(
      res,
      "All subscriptions retrieved successfully",
      subscriptions,
      pagination,
    );
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getSubscription = async (req: Request, res: Response) => {
  try {
    const subscription = await selectors.getSubscriptionById(
      req.params.id as string,
    );
    if (!subscription) return sendError(res, "Subscription not found", 404);
    sendSuccess(res, "Subscription retrieved successfully", subscription);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getAllPayments = async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const countFilter: Record<string, any> = {};
    if (status) countFilter.status = status;
    const [payments, total] = await Promise.all([
      selectors.getAllPayments(req.query),
      selectors.countAllPayments(countFilter),
    ]);
    const pagination = getPaginatedMetadata(total, Number(page), Number(limit));
    sendSuccess(
      res,
      "All payments retrieved successfully",
      payments,
      pagination,
    );
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getPayment = async (req: Request, res: Response) => {
  try {
    const payment = await selectors.getPaymentById(req.params.id as string);
    if (!payment) return sendError(res, "Payment not found", 404);
    sendSuccess(res, "Payment retrieved successfully", payment);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

/**
 * Paystack webhook handler.
 *
 * IMPORTANT: This route must receive the raw request body (Buffer) so that the
 * HMAC signature can be validated.  Register it with `express.raw()` middleware
 * in routes.ts — NOT `express.json()`.
 *
 * Handled events:
 *   charge.success  — marks payment successful, activates subscription, sends
 *                     payment confirmation email via the short queue.
 *   charge.failed   — marks payment as failed.
 *   subscription.disable — marks subscription as cancelled.
 */
export const paystackWebhook = async (req: Request, res: Response) => {
  try {
    const signature = req.headers["x-paystack-signature"] as string | undefined;
    if (!signature) {
      logger.info("[webhook] Missing x-paystack-signature header");
      return res.status(400).end();
    }

    const rawBody = req.body as Buffer;
    if (!services.validateWebhookSignature(rawBody, signature)) {
      logger.info("[webhook] Invalid Paystack signature");
      return res.status(401).end();
    }

    const { event, data } = services.parseWebhookEvent(rawBody);

    // Always acknowledge quickly — do heavy work async
    res.status(200).end();

    if (event === "charge.success") {
      const reference = (data.reference as string | undefined) ?? "";
      if (!reference) return;

      try {
        const paystackData = await services.verifyTransaction(reference);
        if (paystackData.status === "success") {
          const payment = await services.confirmPayment(
            reference,
            paystackData,
          );
          if (payment) {
            shortQueue.enqueue("email:payment_confirmation", {
              userId: String(payment.userId),
              reference,
              amount: paystackData.amount / 100,
              currency: paystackData.currency,
            });
          } else {
            // Not a subscription/credit payment — try donation fallback
            try {
              const donation = await confirmDonation(reference);
              if (donation) {
                shortQueue.enqueue("email:donation_thank_you", {
                  donorEmail: paystackData.customer.email,
                  donorName: donation.isAnonymous
                    ? null
                    : (donation.donorName ?? null),
                  userId: donation.userId ? String(donation.userId) : null,
                  amount: paystackData.amount / 100,
                  currency: paystackData.currency,
                  reference,
                  message: donation.message ?? null,
                });
              }
            } catch (e: any) {
              logger.error("[webhook] donation fallback error:", e.message);
            }
          }
        }
      } catch (err: any) {
        logger.error("[webhook] charge.success processing error:", err.message);
      }
    } else if (event === "charge.failed") {
      const reference = (data.reference as string | undefined) ?? "";
      if (reference) {
        services
          .updatePaymentStatus(reference, "failed")
          .catch((e) =>
            logger.error("[webhook] charge.failed update error:", e.message),
          );
      }
    } else if (event === "subscription.disable") {
      const code = (data as any)?.subscription_code as string | undefined;
      if (code) {
        services
          .cancelSubscriptionByCode(code)
          .catch((e) =>
            logger.error("[webhook] subscription.disable error:", e.message),
          );
      }
    }
  } catch (error: any) {
    logger.error("[webhook] unexpected error:", error.message);
    res.status(500).end();
  }
};

// --- Credit bundle controllers ---

export const getCreditBundles = async (_req: Request, res: Response) => {
  try {
    const bundles = await CreditBundle.find({ isActive: true }).lean();
    sendSuccess(res, "Credit bundles retrieved", bundles);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const initiateCreditPayment = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id ?? (req as any).user?._id;
    const { bundleId } = req.body;

    const userDoc = await User.findById(userId).select("email").lean();
    if (!userDoc?.email) return sendError(res, "User email not found", 400);
    const email = userDoc.email;

    const callbackUrl = `${CONFIG.FRONTEND_URL}/payment/callback`;
    const result = await services.initiateCreditPayment(
      bundleId,
      userId,
      email,
      callbackUrl,
    );

    sendSuccess(
      res,
      "Credit payment initiated",
      {
        payment: result.payment,
        authorizationUrl: result.authorizationUrl,
        reference: result.reference,
      },
      null,
      201,
    );
  } catch (error: any) {
    logger.info(error);
    sendError(res, error.message, 500);
  }
};

// --- Billing status controller ---

export const getBillingStatus = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id ?? (req as any).user?._id;

    const user = await User.findById(userId)
      .select("planTier planDuration dailyUsage credits isSubscribed")
      .lean();

    if (!user) return sendError(res, "User not found", 404);

    const activeSubscription = await Subscription.findOne({
      userId,
      status: "active",
    })
      .sort({ endDate: -1 })
      .lean();

    const planLimits = user.planTier
      ? TIER_LIMITS[user.planTier as keyof typeof TIER_LIMITS]
      : null;

    sendSuccess(res, "Billing status retrieved", {
      planTier: user.planTier ?? null,
      planDuration: user.planDuration ?? null,
      subscriptionEndsAt: activeSubscription?.endDate ?? null,
      dailyUsage: user.dailyUsage ?? null,
      planLimits,
      credits: user.credits ?? { balance: 0, lifetimeEarned: 0 },
      isSubscribed: user.isSubscribed ?? false,
    });
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

// --- Referral controllers ---

export const getReferralStatus = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id ?? (req as any).user?._id;

    const [code, referredCount, user] = await Promise.all([
      services.getOrCreateReferralCode(userId),
      User.countDocuments({ referredBy: userId }),
      User.findById(userId).select("pendingReferralDiscount").lean(),
    ]);

    sendSuccess(res, "Referral status retrieved", {
      code,
      referredCount,
      hasPendingDiscount: user?.pendingReferralDiscount ?? false,
    });
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const lookupReferrer = async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const referrer = await User.findOne({
      referralCode: String(code).toUpperCase(),
    })
      .select("name")
      .lean();

    if (!referrer) {
      return sendError(res, "Referral code not found", 404);
    }

    const name = referrer.name.split(" ")[0] || "A friend";
    const displayName = name.endsWith("s") ? `${name}'` : `${name}'s`;

    sendSuccess(res, "Referrer found", { name, displayName });
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};
