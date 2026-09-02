import webpush from "web-push";
import { ENV } from "@/config/env";
import { runInTransaction, maskId } from "@/utils";
import { IPushSubscription, PushSubscription } from "./models";
import { User } from "@/users";
import { logger } from "@/config";

// Initialize VAPID details once on module load
webpush.setVapidDetails(
  ENV.VAPID.SUBJECT,
  ENV.VAPID.PUBLIC_KEY,
  ENV.VAPID.PRIVATE_KEY,
);

export interface PushPayload {
  title: string;
  body: string;
  icon?: string; // default: "/icons/icon-192x192.png"
  badge?: string; // default: "/icons/badge-72x72.png"
  url?: string; // where to navigate on notification click
  tag?: string; // replaces existing notification with same tag on device
  data?: Record<string, unknown>; // passed through to service worker
}

const NOTIFICATION_SETTINGS_MAP: Record<string, string> = {
  exam_reminder: "examReminders",
  quiz_available: "quizAvailability",
  study_partner_request: "studyPartnerActivity",
  study_partner_message: "studyPartnerActivity",
  program_offering_available: "recommendationUpdates",
  approval_status_change: "approvalStatusChanges",
  recommendation_update: "recommendationUpdates",
  course_announcement: "courseAnnouncements",
  newsletter: "newsletter",
  system_update: "systemUpdates",
  security_alert: "securityAlerts",
  account_activity: "accountActivity",
};

// Notification types that are always enabled (non-negotiable system notifications)
const ALWAYS_ENABLED = new Set(["security_alert", "account_activity"]);

export const isPushEnabled = async (
  userId: string,
  notificationType: string,
): Promise<boolean> => {
  if (ALWAYS_ENABLED.has(notificationType)) return true;

  const user = await User.findById(userId)
    .select("notificationSettings")
    .lean();

  if (!user || !user.notificationSettings) return true;

  const settingsKey = NOTIFICATION_SETTINGS_MAP[notificationType];
  if (!settingsKey) return true;

  const channelSettings = (user.notificationSettings as Record<string, any>)[
    settingsKey
  ];
  return channelSettings?.push !== false;
};

/**
 * Send a push notification to a single subscription.
 * Updates lastUsedAt on success; handles 410 Gone, 429 TooManyRequests,
 * and generic failures with failureCount tracking.
 */
export const sendToSubscription = async (
  subscription: IPushSubscription,
  payload: PushPayload,
): Promise<void> => {
  const fullPayload = {
    ...payload,
    icon: payload.icon ?? "/icon-192x192.png",
    badge: payload.badge ?? "/favicon-32x32.png",
  };

  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: subscription.keys },
      JSON.stringify(fullPayload),
    );

    await runInTransaction(async (session) => {
      await PushSubscription.findByIdAndUpdate(
        subscription._id,
        {
          lastUsedAt: new Date(),
          failureCount: 0,
        },
        { session },
      );
    });
  } catch (err: any) {
    const statusCode: number | undefined = err?.statusCode ?? err?.status;

    if (statusCode === 410) {
      // Browser has unsubscribed — deactivate immediately
      await runInTransaction(async (session) => {
        await PushSubscription.findByIdAndUpdate(
          subscription._id,
          {
            isActive: false,
          },
          { session },
        );
      });
      logger.info(
        `[push] Subscription gone (410), deactivated: ${subscription.endpoint}`,
      );
      return;
    }

    if (statusCode === 429) {
      // Rate limited — log and back off, do not increment failureCount
      logger.info(
        `[push] Rate limited (429) for endpoint: ${subscription.endpoint}`,
      );
      return;
    }

    // Any other error — increment failureCount, deactivate at 5
    const newFailureCount = (subscription.failureCount ?? 0) + 1;
    const update: Record<string, unknown> = { failureCount: newFailureCount };
    if (newFailureCount >= 5) {
      update.isActive = false;
      logger.info(
        `[push] Subscription deactivated after ${newFailureCount} failures: ${subscription.endpoint}`,
      );
    }
    await runInTransaction(async (session) => {
      await PushSubscription.findByIdAndUpdate(subscription._id, update, {
        session,
      });
    });
    logger.error(
      `[push] Failed to send to endpoint ${subscription.endpoint}:`,
      err?.message ?? err,
    );
  }
};

/**
 * Send a push notification to all active subscriptions for a user.
 * Respects IUser.notificationSettings per-channel toggles.
 * Never throws.
 */
export const sendToUser = async (
  userId: string,
  payload: PushPayload,
  notificationType: string,
): Promise<void> => {
  try {
    const enabled = await isPushEnabled(userId, notificationType);
    if (!enabled) return;

    const subscriptions = await PushSubscription.find({
      userId,
      isActive: true,
    });

    await Promise.allSettled(
      subscriptions.map((sub) => sendToSubscription(sub, payload)),
    );
  } catch (err: any) {
    logger.error(
      `[push] sendToUser failed for userId=${maskId(userId)}:`,
      err?.message ?? err,
    );
  }
};

/**
 * Send a push notification to multiple users.
 * Processes in batches of 100 using Promise.allSettled.
 * Never throws.
 */
export const sendToUsers = async (
  userIds: string[],
  payload: PushPayload,
  notificationType: string,
): Promise<void> => {
  try {
    const BATCH_SIZE = 100;
    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      const batch = userIds.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map((uid) => sendToUser(uid, payload, notificationType)),
      );
    }
  } catch (err: any) {
    logger.error(`[push] sendToUsers failed:`, err?.message ?? err);
  }
};

/**
 * Subscribe a device. Upserts by endpoint.
 * userId is nullable — anonymous subscriptions are allowed.
 */
export const subscribe = async (
  userId: string | null,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  userAgent?: string,
): Promise<IPushSubscription> => {
  const deviceLabel = parseDeviceLabel(userAgent);

  const update: Record<string, unknown> = {
    keys: subscription.keys,
    isActive: true,
    failureCount: 0,
    deviceLabel,
  };
  if (userId) update.userId = userId;
  if (userAgent) update.userAgent = userAgent;

  return await runInTransaction(async (session) => {
    const doc = await PushSubscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      { $set: update },
      {
        upsert: true,
        returnDocument: "after",
        setDefaultsOnInsert: true,
        session,
      },
    );

    return doc;
  });
};

/**
 * Unsubscribe a device by endpoint.
 * Sets isActive = false. Does not delete — kept for audit trail.
 */
export const unsubscribe = async (endpoint: string): Promise<void> => {
  await runInTransaction(async (session) => {
    await PushSubscription.findOneAndUpdate(
      { endpoint },
      { isActive: false },
      { session },
    );
  });
};

/**
 * Link an anonymous subscription to a user after login.
 * Safe to call if subscription doesn't exist — no-op.
 */
export const linkSubscriptionToUser = async (
  endpoint: string,
  userId: string,
): Promise<void> => {
  try {
    await runInTransaction(async (session) => {
      await PushSubscription.findOneAndUpdate(
        { endpoint, userId: { $exists: false } },
        { userId },
        { session },
      );
    });
  } catch (err: any) {
    logger.error(
      `[push] linkSubscriptionToUser failed for endpoint=${endpoint}:`,
      err?.message ?? err,
    );
  }
};

/**
 * Get all active subscriptions for a user (for notification settings UI).
 */
export const getUserSubscriptions = async (
  userId: string,
): Promise<
  Pick<
    IPushSubscription,
    "deviceLabel" | "createdAt" | "lastUsedAt" | "endpoint"
  >[]
> => {
  return PushSubscription.find({ userId, isActive: true })
    .select("deviceLabel createdAt lastUsedAt endpoint")
    .lean() as Promise<
    Pick<
      IPushSubscription,
      "deviceLabel" | "createdAt" | "lastUsedAt" | "endpoint"
    >[]
  >;
};

/**
 * Parse a User-Agent string into a human-readable device label.
 */
export const parseDeviceLabel = (userAgent?: string): string => {
  if (!userAgent) return "Unknown Browser";

  if (/iPhone|iPad/.test(userAgent)) return "Safari on iPhone/iPad";
  if (/Android/.test(userAgent) && /Chrome/.test(userAgent))
    return "Chrome on Android";
  if (/Android/.test(userAgent) && /Firefox/.test(userAgent))
    return "Firefox on Android";
  if (/Macintosh/.test(userAgent) && /Chrome/.test(userAgent))
    return "Chrome on Mac";
  if (/Windows/.test(userAgent) && /Chrome/.test(userAgent))
    return "Chrome on Windows";
  if (/Macintosh/.test(userAgent) && /Safari/.test(userAgent))
    return "Safari on Mac";

  return "Unknown Browser";
};

/**
 * Physically remove invalid (deactivated) push subscriptions from the database.
 * Tests the subscription first via a silent ping array; the flag alone is not trusted.
 */
export const sweepInvalidSubscriptions = async (): Promise<void> => {
  try {
    // Find subscriptions currently flagged as inactive to verify them.
    // E.g., failed in a recent push payload.
    const subscriptions = await PushSubscription.find({ isActive: false });
    let deletedCount = 0;
    let revivedCount = 0;

    for (const sub of subscriptions) {
      try {
        // Attempt a silent ping payload. The Service Worker will instantly return
        // if it sees this flag, preventing a spam visual notification if it somehow revived.
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys as any },
          JSON.stringify({ title: "ping", data: { isSilentPing: true } }),
        );

        // If the ping succeeds, the subscription is actually still alive!
        // We must revive it instead of deleting it.
        await PushSubscription.updateOne(
          { _id: sub._id },
          { $set: { isActive: true, failureCount: 0 } },
        );
        revivedCount++;
      } catch (err: any) {
        const statusCode = err?.statusCode ?? err?.status;
        // 410 Gone or 404 Not Found explicitly means the subscription has permanently expired.
        if (statusCode === 410 || statusCode === 404) {
          await PushSubscription.deleteOne({ _id: sub._id });
          deletedCount++;
        }
        // If it's a transient error (e.g. 500, 429), we just skip deleting for now.
      }
    }

    logger.info(
      `[push] Sweep complete: Deleted ${deletedCount} permanently invalid subscriptions. Revived ${revivedCount} falsely marked subscriptions.`,
    );
  } catch (err: any) {
    logger.error(
      `[push] sweepInvalidSubscriptions failed:`,
      err?.message ?? err,
    );
  }
};
