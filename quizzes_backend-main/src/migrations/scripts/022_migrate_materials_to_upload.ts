import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 022: Migrate Materials to Reference Upload Document
 *
 * Strategy:
 *  1. For each material in the `materials` collection, create an Upload document in `uploads` if not already linked.
 *  2. Copy over file metadata (url, filename, mimetype, size, uploadedBy, etc.) to the Upload document.
 *  3. Set a new `upload` field on the material referencing the Upload's _id.
 *  4. Remove legacy file fields from the material (url, filename, mimetype, size, storageUrl, cloudinaryPublicId, etc.).
 *  5. Leave a migration log for each migrated material.
 *
 * This migration is idempotent: it skips materials that already have an `upload` ObjectId.
 */
export async function up(mongoose: Mongoose) {
  logger.info("[022] Migrating materials to reference Upload document...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("[022] No db connection");

  const collections = (await db.listCollections().toArray()).map((c) => c.name);
  if (!collections.includes("materials")) {
    logger.info("[022] No materials collection found. Exiting.");
    return;
  }
  const materialsCol = db.collection("materials");
  const uploadsCol = db.collection("uploads");

  let migrated = 0;
  let skipped = 0;
  const cursor = materialsCol.find({
    $or: [
      { upload: { $exists: false } },
      { storageUrl: { $exists: true } },
      { cloudinaryPublicId: { $exists: true } },
    ],
  });
  for await (const material of cursor) {
    // If already migrated and legacy fields are gone, skip
    if (
      material.upload &&
      !material.storageUrl &&
      !material.cloudinaryPublicId
    ) {
      skipped++;
      continue;
    }
    // If already has upload, just remove legacy fields
    if (material.upload) {
      await materialsCol.updateOne(
        { _id: material._id },
        {
          $unset: {
            storageUrl: "",
            cloudinaryPublicId: "",
          },
        },
      );
      migrated++;
      continue;
    }
    // If legacy fields exist but no upload, migrate
    if (material.storageUrl) {
      const uploadDoc = {
        url: material.storageUrl,
        originalFilename: material.filename,
        mimetype: material.mimeType,
        size: material.size,
        folder: "materials",
        uploadedBy: material.uploadedBy,
        createdAt: material.uploadedAt || new Date(),
        updatedAt: material.processedAt || new Date(),
      };
      const { insertedId } = await uploadsCol.insertOne(uploadDoc);
      await materialsCol.updateOne(
        { _id: material._id },
        {
          $set: { upload: insertedId },
          $unset: {
            storageUrl: "",
            cloudinaryPublicId: "",
          },
        },
      );
      migrated++;
      logger.info(
        `[022] Migrated material ${material._id} to upload ${insertedId}`,
      );
      continue;
    }
    // If neither upload nor legacy fields, skip
    skipped++;
  }
  logger.info(
    `[022] Migration complete. Migrated: ${migrated}, Skipped: ${skipped}`,
  );
}
