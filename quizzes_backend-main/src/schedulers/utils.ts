import type { EmailEventPayload } from "./interfaces";
import { BaseQueue } from "./queues/base.queue";
import { Worker, Job as BullJob } from "bullmq";
import { redisConnection, logger } from "@/config";
import { publishers } from "@/socket";
import HANDLER_CONSTANTS from "./constants";
import { EmailCampaign } from "@/email";

export function createWorker(baseQueue: BaseQueue, concurrency: number) {
  const worker = new Worker(
    baseQueue.name,
    async (bullJob: BullJob) => {
      const handler = baseQueue.handlers.get(bullJob.name);
      if (!handler) {
        logger.error(
          `[Worker] No handler registered for job type "${bullJob.name}"`,
        );
        throw new Error(`No handler registered for job type "${bullJob.name}"`);
      }

      const jobAdapter = {
        id: bullJob.id || "unknown",
        type: bullJob.name,
        payload: bullJob.data,
      };

      await handler(jobAdapter);
    },
    {
      connection: redisConnection as any,
      concurrency,
    },
  );

  worker.on("completed", async (job) => {
    logger.info(
      `[Worker] ${baseQueue.name} job completed: ${job.name} (id=${job.id})`,
    );
  });

  worker.on("failed", async (job, err) => {
    logger.error(
      `[Worker] ${baseQueue.name} job failed: ${job?.name} (id=${job?.id}) - ${err.message}`,
    );

    if (job?.name?.startsWith("email:campaign:")) {
      const campaignId = (job as any)?.data?.campaignId;
      if (campaignId) {
        const event = {
          type: job.name,
          campaignId,
          status: "failed",
          timestamp: new Date().toISOString(),
          details: {
            reason: err.message,
          },
        };
        await redisConnection.publish("email:events", JSON.stringify(event));
        logger.info(
          `[Worker] Published failed event to email:events for ${campaignId}`,
        );
      }
    }
  });

  worker.on("error", (err) => {
    logger.error(`[Worker] ${baseQueue.name} worker error:`, err);
  });

  return worker;
}

  export async function shutdownWorkers(workers: Worker[], signal: string) {
    try {
      logger.info(
        `[Worker] Received ${signal} signal. Shutting down workers...`,
      );

      await Promise.all(workers.map((worker) => worker.close()));
      logger.info(`[Worker] All workers shut down successfully.`);
      process.exit(0);
    } catch (error) {
      logger.error("[Worker] Error shutting down workers:", error);
      process.exit(1);
    }
  }

const publishEmailEvent = async (payload: EmailEventPayload): Promise<void> => {
  try {
    await redisConnection.publish("email:events", JSON.stringify(payload));
  } catch (error) {
    logger.error("[email:events] Failed to publish event:", error);
  }
};

const publishNotificationEvent = async (
  type: string,
  payload: Record<string, unknown>,
): Promise<void> => {
  try {
    await redisConnection.publish(
      "notification:events",
      JSON.stringify({ type, ...payload, timestamp: new Date().toISOString() }),
    );
  } catch (error) {
    logger.error("[notification:events] Failed to publish event:", error);
  }
};

const publishAppEvent = async (
  type: string,
  payload: Record<string, unknown>,
): Promise<void> => {
  try {
    const { sessionId, userId, ...rest } = payload;
    if (sessionId && userId) {
      publishers.appSignal(String(sessionId), String(userId), {
        type,
        payload: rest,
        timestamp: new Date(),
      });
    } else {
      // Fallback for system-wide events if no user/session context
      await redisConnection.publish(
        "app:worker:signals",
        JSON.stringify({
          type,
          ...payload,
          timestamp: new Date().toISOString(),
        }),
      );
    }
  } catch (error) {
    logger.error("[publishAppEvent] Failed to publish app event:", error);
  }
};

export const PUBLISHERS = {
  publishEmailEvent,
  publishNotificationEvent,
  publishAppEvent,
};

const acquireSessionTriggerLock = async (
  sessionId: string,
  token: string,
): Promise<boolean> => {
  const key = `lock:app:session:trigger:${sessionId}`;
  const result = await redisConnection.set(
    key,
    token,
    "EX",
    HANDLER_CONSTANTS.SESSION_TRIGGER_LOCK_TTL_SECONDS,
    "NX",
  );
  return result === "OK";
};

const releaseSessionTriggerLock = async (
  sessionId: string,
  token: string,
): Promise<void> => {
  const key = `lock:app:session:trigger:${sessionId}`;
  await redisConnection.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    1,
    key,
    token,
  );
};

export const TRANSACTION_LOCKS = {
  acquireSessionTriggerLock,
  releaseSessionTriggerLock,
};

const shouldEnqueueExamReminder = async (params: {
  userId: string;
  courseRef: string;
  examAtIso: string;
  daysUntil: number;
}): Promise<boolean> => {
  const { userId, courseRef, examAtIso, daysUntil } = params;
  const dedupeKey = `dedupe:push:exam_reminder:${userId}:${courseRef}:${examAtIso}:${daysUntil}`;

  const result = await redisConnection.set(
    dedupeKey,
    "1",
    "EX",
    HANDLER_CONSTANTS.EXAM_REMINDER_DEDUPE_TTL_SECONDS,
    "NX",
  );

  return result === "OK";
};

const shouldEnqueuePublicPreExamQuiz = async (params: {
  examEntryId: string;
  sessionId: string;
  courseId: string;
  lectureKey?: string;
}): Promise<boolean> => {
  const dedupeKey = `dedupe:${buildPublicPreExamQuizJobId(params)}`;
  const result = await redisConnection.set(
    dedupeKey,
    "1",
    "EX",
    HANDLER_CONSTANTS.PUBLIC_PREEXAM_QUIZ_DEDUPE_TTL_SECONDS,
    "NX",
  );
  return result === "OK";
};


const incrementPublicPreExamMetric = async (
  key:
    | "attempted"
    | "generated"
    | "skipped_duplicate"
    | "skipped_no_material"
    | "failed",
): Promise<void> => {
  try {
    await redisConnection.incr(`metrics:quiz:public_preexam:${key}`);
  } catch {
    // metrics should never block queue processing
  }
};

export const ENQUEUE_REMINDERS = {
  shouldEnqueueExamReminder,
  shouldEnqueuePublicPreExamQuiz,
  incrementPublicPreExamMetric,
};

export const normalizeForMatch = (input: string): string =>
  input.toLowerCase().replace(/[^a-z0-9]/g, "");

export const buildPublicPreExamQuizJobId = (params: {
  examEntryId: string;
  sessionId: string;
  courseId: string;
  lectureKey?: string;
}): string => {
  const { examEntryId, sessionId, courseId, lectureKey } = params;
  return lectureKey
    ? `public_preexam_quiz:${examEntryId}:${sessionId}:${courseId}:lecture:${lectureKey}`
    : `public_preexam_quiz:${examEntryId}:${sessionId}:${courseId}:d3`;
};

export const maybeMarkEmailCampaignDone = async (campaignId: string) => {
  const updated = await EmailCampaign.findOneAndUpdate(
    {
      _id: campaignId,
      status: "dispatching",
      dispatchTotal: { $gt: 0 },
      $expr: {
        $gte: [{ $add: ["$stats.sent", "$stats.failed"] }, "$dispatchTotal"],
      },
    },
    { status: "done", completedAt: new Date() },
    { returnDocument: "after" },
  );

  if (!updated) return;

  await publishEmailEvent({
    type: "email:campaign:dispatch:completed",
    campaignId,
    status: "completed",
    timestamp: new Date().toISOString(),
    details: {
      sent: updated.stats?.sent ?? 0,
      failed: updated.stats?.failed ?? 0,
      total: updated.dispatchTotal ?? 0,
    },
  });
};
