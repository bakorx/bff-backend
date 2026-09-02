import { logger } from "./config";
import { connectDB } from "./db";
import {
  createWorker,
  longQueue,
  shortQueue,
  shutdownWorkers,
  startSchedulers,
  stopSchedulers,
} from "./schedulers";
import {
  systemHandler,
  aiHandler,
  emailHandler,
  studyRoomHandler,
  pushHandler,
  materialHandler,
  memoryPipelineHandler,
  delayedRecHandler,
  livenessHandler,
} from "./schedulers/handlers";

async function startWorker() {
  try {
    logger.info("[Worker] Starting worker processes...");
    await connectDB();
    logger.info("[Worker] Database connected");

    logger.info("[Worker] Registering all handlers...");
    aiHandler.registerHandlers();
    emailHandler.registerHandlers();
    materialHandler.registerHandlers();
    pushHandler.registerHandlers();
    studyRoomHandler.registerRoomHandlers();
    systemHandler.registerHandlers();
    memoryPipelineHandler.registerHandlers();
    delayedRecHandler.registerHandlers();
    livenessHandler.registerHandlers();

    logger.info("[Worker] Starting schedulers...");
    await startSchedulers();

    logger.info("[Worker] Starting background job processor...");

    const shortWorker = createWorker(shortQueue, 10);
    const longWorker = createWorker(longQueue, 2);

    const allWorkers = [shortWorker, longWorker];

    process.on("SIGTERM", async () => {
      logger.info(
        "[Worker] Received SIGTERM, shutting down workers and schedulers...",
      );
      shutdownWorkers(allWorkers, "SIGTERM");
      await stopSchedulers();
      logger.info("[Worker] Graceful shutdown complete.");
      process.exit(0);
    });

    process.on("SIGINT", async () => {
      logger.info(
        "[Worker] Received SIGINT, shutting down workers and schedulers...",
      );
      shutdownWorkers(allWorkers, "SIGINT");
      await stopSchedulers();
      logger.info("[Worker] Graceful shutdown complete.");
      process.exit(0);
    });

    logger.info("[Worker] All workers and schedulers started successfully.");
    logger.info(
      "[Worker]: Queues ready, listening for jobs on BullMQ channels...",
    );
  } catch (error) {
    logger.error("[Worker] Failed to start worker:", error);
    process.exit(1);
  }
}

startWorker().catch((error) => {
  logger.error("[Worker] Unhandled error:", error);
  process.exit(1);
});
