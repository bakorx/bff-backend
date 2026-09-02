import mongoose from "mongoose";
import { CONFIG, logger } from "@/config";
import { maskId } from "@/utils";

// Setup connection listeners
mongoose.connection.on("connected", () => {
  logger.info("[Database] Connection established");
});

mongoose.connection.on("error", (err) => {
  logger.error("[Database] Runtime connection error: ", err.message);
});

mongoose.connection.on("disconnected", () => {
  logger.warn("[Database] Connection lost / disconnected");
});

/**
 * Connect to MongoDB with automatic retry mechanism.
 * If connection fails after all retry attempts, calls process.exit(1) to terminate
 * the process and prevent the app server or background workers from running without a DB.
 */
export async function connectDB(
  maxRetries = 5,
  retryDelayMs = 3000,
): Promise<typeof mongoose> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(
        `[Database] Attempting connection (attempt ${attempt}/${maxRetries})...`,
      );
      const conn = await mongoose.connect(CONFIG.DATABASE.MONGO_URI, {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });
      logger.info(
        `[Database] Connected successfully to ${maskId(mongoose.connection.host as string) || "MongoDB"}`,
      );
      return conn;
    } catch (error: any) {
      logger.error(
        `[Database] Connection attempt ${attempt} failed: ${error.message}`,
      );
      if (attempt < maxRetries) {
        logger.info(`[Database] Retrying in ${retryDelayMs / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  logger.error(
    `[Database] FATAL: Could not connect to MongoDB after ${maxRetries} attempts. Terminating process with exit code 1.`,
  );
  process.exit(1);
}

export async function disconnectDB(): Promise<void> {
  try {
    await mongoose.disconnect();
    logger.info("[Database] Disconnected successfully");
  } catch (error: any) {
    logger.error("[Database] Error disconnecting from DB: ", error.message);
  }
}
