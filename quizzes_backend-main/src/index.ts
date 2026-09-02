import { connectDB, disconnectDB } from "./db";
import { startServer, stopServer } from "./server";
import { logger } from "./config";

async function startApp() {
  try {
    logger.info("[Index] Starting app...");
    await connectDB();
    await startServer();

    process.on("SIGTERM", async () => {
      logger.info("[Index] Received SIGTERM, shutting down...");
      await stopServer();
      await disconnectDB();
      logger.info("[Index] Graceful shutdown complete.");
      process.exit(0);
    });

    process.on("SIGINT", async () => {
      logger.info("[Index] Received SIGINT, shutting down...");
      await stopServer();
      await disconnectDB();
      logger.info("[Index] Graceful shutdown complete.");
      process.exit(0);
    });
    logger.info("[Index] App started successfully.");
  } catch (error) {
    logger.error("[Index] Failed to start app: ", error);
    process.exit(1);
  }
}
startApp();
