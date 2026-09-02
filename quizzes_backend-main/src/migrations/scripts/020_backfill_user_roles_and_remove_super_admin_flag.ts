import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 020:
 * 1) Promote legacy `isSuperAdmin: true` users to `role: "super_admin"`.
 * 2) Backfill missing/invalid roles to `"student"`.
 * 3) Remove legacy `isSuperAdmin` field from all user documents.
 */
export async function up(mongoose: Mongoose) {
  logger.info("[020] Backfilling user roles and removing isSuperAdmin...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("[020] No db connection");

  const usersCol = db.collection("users");
  const validRoles = ["student", "creator", "moderator", "super_admin"];

  const promoteResult = await usersCol.updateMany(
    { isSuperAdmin: true },
    { $set: { role: "super_admin" } },
  );

  const backfillResult = await usersCol.updateMany(
    {
      $or: [
        { role: { $exists: false } },
        { role: null },
        { role: "" },
        { role: { $nin: validRoles } },
      ],
    },
    { $set: { role: "student" } },
  );

  const unsetResult = await usersCol.updateMany(
    { isSuperAdmin: { $exists: true } },
    { $unset: { isSuperAdmin: "" } },
  );

  logger.info(
    `[020] Promoted to super_admin by flag: ${promoteResult.modifiedCount}`,
  );
  logger.info(
    `[020] Backfilled default student roles: ${backfillResult.modifiedCount}`,
  );
  logger.info(`[020] Removed isSuperAdmin field: ${unsetResult.modifiedCount}`);
  logger.info("[020] Migration complete.");
}
