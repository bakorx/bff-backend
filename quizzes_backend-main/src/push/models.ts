import mongoose, { Document, Schema, Types } from "mongoose";

/**
 * IPushSubscription — one per device/browser.
 *
 * userId is optional — anonymous subscriptions are created before login
 * and linked to a user after authentication via linkSubscriptionToUser().
 *
 * Indexes:
 *   { userId: 1 }
 *   { endpoint: 1 }           unique
 *   { userId: 1, createdAt: -1 }
 *   { isActive: 1 }
 */
export interface IPushSubscription extends Document {
  // Optional until user logs in — linked via linkSubscriptionToUser()
  userId?: Types.ObjectId; // ref: "User"

  // Web Push subscription object from browser
  endpoint: string; // unique per device/browser
  keys: {
    p256dh: string;
    auth: string;
  };

  // Device context — shown in notification settings UI
  userAgent?: string; // raw UA string stored for reference
  deviceLabel?: string; // e.g. "Chrome on iPhone", "Firefox on MacBook"

  isActive: boolean; // false = unsubscribed or expired
  lastUsedAt?: Date; // updated on every successful push send
  failureCount: number; // incremented on failed send, deactivated at 5

  createdAt: Date;
  updatedAt: Date;
}

const PushSubscriptionSchema = new Schema<IPushSubscription>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    endpoint: {
      type: String,
      required: true,
      unique: true,
    },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    userAgent: { type: String },
    deviceLabel: { type: String },
    isActive: { type: Boolean, default: true },
    lastUsedAt: { type: Date },
    failureCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

PushSubscriptionSchema.index({ userId: 1 });
PushSubscriptionSchema.index({ userId: 1, createdAt: -1 });
PushSubscriptionSchema.index({ isActive: 1 });

export const PushSubscription = mongoose.model<IPushSubscription>(
  "PushSubscription",
  PushSubscriptionSchema,
);
