import { Schema, Model, model } from "mongoose";
import { IContact } from "./interfaces";
import { randomBytes } from "crypto";

const ContactSchema: Schema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Invalid email address"],
    },
    name: { type: String, trim: true },
    studentId: { type: String, trim: true, index: true },
    source: {
      type: String,
      enum: [
        "landing_hero",
        "landing_cta",
        "in_app",
        "manual",
        "import",
        "timetable_reminder",
      ],
      default: "landing_hero",
    },

    // Waitlist lane
    isWaitlist: { type: Boolean, default: false },
    waitlistStatus: {
      type: String,
      enum: ["active", "removed"],
      default: "active",
    },
    waitlistJoinedAt: { type: Date },

    // Newsletter lane
    isNewsletter: { type: Boolean, default: false },
    newsletterStatus: {
      type: String,
      enum: ["pending", "active", "unsubscribed", "bounced"],
      default: "pending",
    },
    confirmationToken: { type: String },
    confirmedAt: { type: Date },
    unsubscribeToken: {
      type: String,
      default: () => randomBytes(32).toString("hex"),
    },
    unsubscribedAt: { type: Date },
    bouncedAt: { type: Date },
    bounceReason: { type: String },
    subscribedAt: { type: Date },
  },
  { timestamps: true },
);

// Query indexes
ContactSchema.index({ isWaitlist: 1, waitlistStatus: 1 });
ContactSchema.index({ isNewsletter: 1, newsletterStatus: 1 });
ContactSchema.index({ source: 1 });
ContactSchema.index({ createdAt: -1 });

export const Contact: Model<IContact> = model<IContact>(
  "Contact",
  ContactSchema,
);
