import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 052: Backfill Material Types.
 *
 * Sets materialType: "learning_material" for all existing materials where materialType is unset.
 */
export async function up(mongoose: Mongoose) {
  logger.info("Starting migration: 052_backfill_material_types...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("No active DB connection");

  const materialsCollection = db.collection("materials");

  const result = await materialsCollection.updateMany(
    {
      $or: [
        { materialType: { $exists: false } },
        { materialType: null },
      ],
    },
    {
      $set: {
        materialType: "learning_material",
      },
    },
  );

  logger.info(
    `Migration 052 complete. Backfilled materialType for ${result.modifiedCount} materials.`,
  );
}

export async function down(mongoose: Mongoose) {
  logger.info("Rollback 052: Keeping materialType values.");
}
