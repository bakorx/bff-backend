import { Mongoose } from "mongoose";
import { logger } from "@/config";

export const dependsOn = ["043_restore_uploads_from_cloudinary"];

/**
 * Migration 044: Delete materials whose upload ref could not be restored.
 *
 * After 043 ran, any material still pointing to a non-existent Upload document
 * has no file in Cloudinary and cannot be served. Delete them.
 */
export async function up(mongoose: Mongoose) {
  logger.info("[044] Deleting unrestorable materials...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("[044] No db connection");

  const materialsCol = db.collection("materials");
  const uploadsCol = db.collection("uploads");

  const allMaterials = await materialsCol.find({}).toArray();
  const toDelete: string[] = [];

  for (const mat of allMaterials) {
    if (!mat.upload) {
      toDelete.push(String(mat._id));
      continue;
    }
    const upload = await uploadsCol.findOne({ _id: mat.upload });
    if (!upload) {
      toDelete.push(String(mat._id));
    }
  }

  if (toDelete.length === 0) {
    logger.info("[044] No unrestorable materials found. Nothing to delete.");
    return;
  }

  const { deletedCount } = await materialsCol.deleteMany({
    _id: {
      $in: toDelete.map((id) => new (require("mongoose").Types.ObjectId)(id)),
    },
  });

  logger.info(`[044] Deleted ${deletedCount} unrestorable material(s):`);
  toDelete.forEach((id) => logger.info(`         - ${id}`));
  logger.info("[044] Migration complete.");
}
