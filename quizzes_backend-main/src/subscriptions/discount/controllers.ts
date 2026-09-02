import { Request, Response } from "express";
import { PromoCode } from "./models";
import { previewDiscount } from "./services";
import { sendSuccess, sendError, runInTransaction } from "@/utils";
import { Package, CreditBundle } from "../models";

// --- Admin controllers ---

export const createPromoCode = async (req: Request, res: Response) => {
  try {
    const createdBy = (req as any).user?.id;
    const { expiresAt, ...rest } = req.body;

    const code = await runInTransaction(async (session) => {
      return new PromoCode({
        ...rest,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        createdBy,
      }).save({ session });
    });

    sendSuccess(res, "Promo code created", code, null, 201);
  } catch (error: any) {
    if (error.code === 11000)
      return sendError(res, "Promo code already exists", 409);
    sendError(res, error.message, 500);
  }
};

export const listPromoCodes = async (_req: Request, res: Response) => {
  try {
    const codes = await PromoCode.find().sort({ createdAt: -1 }).lean();
    sendSuccess(res, "Promo codes retrieved", codes);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const updatePromoCode = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { expiresAt, ...rest } = req.body;

    const code = await runInTransaction(async (session) => {
      return PromoCode.findByIdAndUpdate(
        id,
        {
          ...rest,
          ...(expiresAt !== undefined
            ? { expiresAt: expiresAt ? new Date(expiresAt) : null }
            : {}),
        },
        { returnDocument: "after", session },
      );
    });

    if (!code) return sendError(res, "Promo code not found", 404);
    sendSuccess(res, "Promo code updated", code);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const deletePromoCode = async (req: Request, res: Response) => {
  try {
    const code = await runInTransaction(async (session) => {
      return PromoCode.findByIdAndUpdate(
        req.params.id,
        { isActive: false },
        { returnDocument: "after", session },
      );
    });
    if (!code) return sendError(res, "Promo code not found", 404);
    sendSuccess(res, "Promo code deactivated", code);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

// --- Public controllers ---

export const validatePromoCode = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { code, referralCode, packageId, bundleId } = req.body;

    // Determine the amount to preview against
    let amountGHS = 0;
    let packageDuration: string | undefined;
    let packageTier: string | undefined;

    if (packageId) {
      const pkg = await Package.findById(packageId).lean();
      if (!pkg) return sendError(res, "Package not found", 404);
      amountGHS = pkg.priceGHS ?? pkg.price;
      packageDuration = pkg.durationType;
      packageTier = pkg.tier;
    } else if (bundleId) {
      const bundle = await CreditBundle.findById(bundleId).lean();
      if (!bundle) return sendError(res, "Bundle not found", 404);
      amountGHS = bundle.priceGHS;
    } else {
      return sendError(res, "packageId or bundleId required", 400);
    }

    const result = await previewDiscount({
      userId,
      originalAmountGHS: amountGHS,
      promoCode: code,
      referralCode,
      packageDuration,
      packageTier,
    });

    const isPromoApplied =
      !code ||
      result.discounts.some(
        (d) =>
          d.type === "promo" &&
          d.label.toUpperCase().includes(String(code).toUpperCase()),
      );

    const isReferralApplied =
      !referralCode ||
      result.discounts.some(
        (d) =>
          d.type === "referral" && d.label.toLowerCase().includes("referral"),
      );

    if (!isPromoApplied) {
      return sendError(
        res,
        result.promoCodeCheck?.reason || "Invalid or expired promo code",
        400,
      );
    }

    if (!isReferralApplied) {
      return sendError(res, "Invalid or already used referral code", 400);
    }

    sendSuccess(res, "Discount preview", result);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};
