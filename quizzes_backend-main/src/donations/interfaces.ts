import { Document, Types } from "mongoose";

export type DonationStatus = "pending" | "confirmed" | "failed";

export interface IDonation extends Document {
  amount: number;
  donorName?: string;
  message?: string;
  userId?: Types.ObjectId;
  paystackReference: string;
  status: DonationStatus;
  isAnonymous: boolean;
  createdAt: Date;
  updatedAt: Date;
}
