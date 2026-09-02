import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 021: Remove legacy memberships collection.
 */
export async function up(mongoose: Mongoose) {
  logger.info("[021] Removing memberships collection...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("[021] No db connection");

  try {
    await db.collection("memberships").drop();
    logger.info("[021] memberships collection dropped.");
  } catch (error: any) {
    if (error?.codeName === "NamespaceNotFound") {
      logger.info("[021] memberships collection does not exist; skipping.");
    } else {
      throw error;
    }
  }

  logger.info("[021] Migration complete.");
}
