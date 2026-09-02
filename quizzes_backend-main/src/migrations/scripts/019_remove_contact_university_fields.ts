import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 019: Remove legacy university fields from contacts.
 *
 * New waitlist/contact model keeps only generic contact identity + lane states.
 * This migration unsets `university` and `universityId` from all contact records.
 */
export async function up(mongoose: Mongoose) {
  logger.info("[019] Removing university fields from contacts...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("[019] No db connection");

  const contactsCol = db.collection("contacts");

  const result = await contactsCol.updateMany(
    {},
    {
      $unset: {
        university: "",
        universityId: "",
      },
    },
  );

  logger.info(`[019] Contacts updated: ${result.modifiedCount}`);
  logger.info("[019] Migration complete.");
}
