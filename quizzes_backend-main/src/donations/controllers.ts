import { Request, Response } from "express";
import { z } from "zod";
import { sendSuccess, sendError } from "@/utils";
import * as services from "./services";

const InitiateSchema = z.object({
  email: z.email(),
  amountGHS: z.number().min(1).max(10000),
  donorName: z.string().max(80).optional(),
  message: z.string().max(280).optional(),
  isAnonymous: z.boolean().optional(),
});

export const initiateDonation = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const parsed = InitiateSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "Invalid donation details", 400, parsed.error.flatten());
      return;
    }

    const { email, amountGHS, donorName, message, isAnonymous } = parsed.data;
    const userId = (req as Request & { user?: { id: string } }).user?.id;

    const result = await services.initiateDonation(email, amountGHS, {
      donorName,
      message,
      userId,
      isAnonymous,
    });

    sendSuccess(res, "Donation initiated", {
      authorizationUrl: result.authorizationUrl,
      reference: result.reference,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to initiate donation";
    sendError(res, message, 400);
  }
};

export const verifyDonation = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const reference = String(req.params.reference);
    const donation = await services.confirmDonation(reference);
    if (!donation) {
      sendError(res, "Donation not found or already processed", 404);
      return;
    }
    sendSuccess(res, "Donation confirmed", { donation });
  } catch {
    sendError(res, "Failed to verify donation", 500);
  }
};

export const getDonationLedger = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const ledger = await services.getDonationLedger();
    sendSuccess(res, "Donation ledger", ledger);
  } catch {
    sendError(res, "Failed to fetch donation ledger", 500);
  }
};
