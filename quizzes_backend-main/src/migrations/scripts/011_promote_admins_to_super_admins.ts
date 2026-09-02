import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 011: Promote all existing users with role "admin" to "super_admin"
 * and set isSuperAdmin = true.
 *
 * Background: prior to the institution hierarchy, the platform only had a flat
 * "admin" role. Now that institution-scoped roles exist ("admin" means an
 * admin of a specific campus/school/department node), any user who was already
 * a platform-level admin should be elevated to "super_admin" — the role that
 * grants full cross-institution access. The new `isSuperAdmin` boolean is also
 * set so code can check that field without inspecting the (now-deprecated) role.
 *
 * Rollback:
 *   db.users.updateMany({ role: "super_admin" }, { $set: { role: "admin", isSuperAdmin: false } })
 *   — NOTE: only run rollback if no genuine super_admins were created after
 *     this migration, otherwise you will demote them too.
 */
export async function up(mongoose: Mongoose) {
  logger.info(
    '[011] Promoting existing "admin" users to "super_admin" and setting isSuperAdmin=true...',
  );

  const db = mongoose.connection.db;
  if (!db) {
    logger.info("[011] No db object available. Ensure mongoose is connected.");
    return;
  }

  const usersCol = db.collection("users");

  // Confirm the 'admin' role exists in the collection before promoting
  const adminCount = await usersCol.countDocuments({ role: "admin" });
  if (adminCount === 0) {
    logger.info('[011] No users with role "admin" found. Nothing to promote.');
    return;
  }

  const result = await usersCol.updateMany(
    { role: "admin" },
    { $set: { role: "super_admin", isSuperAdmin: true } },
  );

  logger.info(
    `[011] Done. Promoted ${result.modifiedCount} user(s) to "super_admin".`,
  );
}
