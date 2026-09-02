import { Schema, model } from "mongoose";
import { IDonation } from "./interfaces";

const DonationSchema = new Schema<IDonation>(
  {
    amount: { type: Number, required: true },
    donorName: { type: String },
    message: { type: String, maxlength: 280 },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    paystackReference: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ["pending", "confirmed", "failed"],
      default: "pending",
    },
    isAnonymous: { type: Boolean, default: false },
  },
  { timestamps: true },
);

DonationSchema.index({ status: 1, createdAt: -1 });

export const Donation = model<IDonation>("Donation", DonationSchema);
