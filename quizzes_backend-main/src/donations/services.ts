import { nanoid } from "nanoid";
import { Donation } from "./models";
import { IDonation } from "./interfaces";
import { runInTransaction } from "@/utils";
import {
  initializeTransaction,
  PaystackVerifyResult,
  verifyTransaction,
} from "@/subscriptions";

const PLATFORM_PLEDGE_PERCENT = 0.05;
const MIN_DONATION_GHS = 1;
const MAX_DONATION_GHS = 10000;

export async function initiateDonation(
  email: string,
  amountGHS: number,
  options: {
    donorName?: string;
    message?: string;
    userId?: string;
    isAnonymous?: boolean;
  } = {},
): Promise<{
  donation: IDonation;
  authorizationUrl: string;
  reference: string;
}> {
  if (amountGHS < MIN_DONATION_GHS || amountGHS > MAX_DONATION_GHS) {
    throw new Error(
      `Donation amount must be between GHS ${MIN_DONATION_GHS} and ${MAX_DONATION_GHS}`,
    );
  }

  const reference = `don_${nanoid(16)}`;
  const amountPesewas = Math.round(amountGHS * 100);

  const paystackResult = await initializeTransaction(
    email,
    amountPesewas,
    reference,
    { type: "donation", donorName: options.donorName ?? "anonymous" },
  );

  const donation = await runInTransaction(async (session) => {
    const doc = new Donation({
      amount: amountGHS,
      donorName: options.isAnonymous ? undefined : options.donorName,
      message: options.message,
      userId: options.userId ? options.userId : undefined,
      paystackReference: reference,
      status: "pending",
      isAnonymous: options.isAnonymous ?? false,
    });
    return doc.save({ session });
  });

  return {
    donation,
    authorizationUrl: paystackResult.authorization_url,
    reference: paystackResult.reference,
  };
}

export async function confirmDonation(
  reference: string,
): Promise<IDonation | null> {
  // Verify with Paystack first
  let paystackData: PaystackVerifyResult;
  try {
    paystackData = await verifyTransaction(reference);
  } catch {
    return null;
  }

  if (paystackData.status !== "success") return null;

  return runInTransaction(async (session) => {
    return Donation.findOneAndUpdate(
      { paystackReference: reference, status: "pending" },
      { status: "confirmed" },
      { returnDocument: "after", session },
    );
  });
}

export async function getDonationLedger(): Promise<{
  donations: IDonation[];
  totalRaisedGHS: number;
  platformPledgeGHS: number;
}> {
  const [donations, aggregate] = await Promise.all([
    Donation.find({ status: "confirmed" })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean(),
    Donation.aggregate([
      { $match: { status: "confirmed" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
  ]);

  const totalRaisedGHS = aggregate[0]?.total ?? 0;

  return {
    donations: donations as IDonation[],
    totalRaisedGHS,
    platformPledgeGHS: +(totalRaisedGHS * PLATFORM_PLEDGE_PERCENT).toFixed(2),
  };
}
