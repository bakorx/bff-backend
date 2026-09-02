import {
  Queue,
  JobsOptions,
  Worker,
  Processor,
  Job as BullJob,
  JobType,
} from "bullmq";
import { logger, redisConnection } from "@/config";

export type JobPayload = Record<string, unknown>;

export interface Job {
  id: string;
  type: string;
  payload: JobPayload;
}

export type JobHandler = (job: Job) => Promise<void>;

export class BaseQueue {
  private readonly bullQueue: Queue;
  public readonly handlers = new Map<string, JobHandler>();

  constructor(
    public readonly name: string,
    private readonly concurrency: number,
  ) {
    this.bullQueue = new Queue(name, {
      connection: redisConnection as any,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 30000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });
  }
  get queue(): Queue {
    return this.bullQueue;
  }

  register(type: string, handler: JobHandler): this {
    this.handlers.set(type, handler);
    return this;
  }

  async enqueue(
    type: string,
    payload: JobPayload = {},
    maxAttempts = 3,
    jobId?: string,
    delayMs?: number,
  ): Promise<void> {
    const options: JobsOptions = {
      attempts: maxAttempts,
      ...(jobId ? { jobId } : {}),
      ...(typeof delayMs === "number" && delayMs > 0 ? { delay: delayMs } : {}),
    };

    const bullJob = await this.bullQueue.add(type, payload, options);
    logger.info(`[${this.name}] enqueued: ${type} (id=${bullJob.id})`);
  }

  async reconcileJobsByPrefix(
    prefix: string,
    keepJobIds: Set<string>,
  ): Promise<void> {
    const states: JobType[] = [
      "delayed",
      "waiting",
      "prioritized",
      "paused",
      "active",
    ];
    const jobs = await this.bullQueue.getJobs(states, 0, -1, true);

    for (const job of jobs) {
      if (!job.id || typeof job.id !== "string") continue;
      if (!job.id.startsWith(prefix)) continue;
      if (keepJobIds.has(job.id)) continue;

      try {
        await job.remove();
      } catch (error) {
        logger.error(
          `[${this.name}] failed to remove stale job ${job.id}:`,
          error,
        );
      }
    }
  }

  async getJobs(states: JobType[], start = 0, end = -1): Promise<BullJob[]> {
    return await this.bullQueue.getJobs(states, start, end, true);
  }

  async clean(
    graceMs: number,
    limit: number,
    status:
      "completed" | "failed" | "wait" | "active" | "delayed" | "prioritized",
  ): Promise<string[]> {
    return await this.bullQueue.clean(graceMs, limit, status);
  }
}
