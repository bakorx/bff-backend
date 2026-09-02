import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 016: Centralize Uploads
 *
 * Strategy:
 *  1. Iterate over all `materials` and `emailcampaignimages` which have legacy `url` fields.
 *  2. For each, create a new document in `uploads`.
 *  3. Set `upload` referencing the new `_id`, and unset `url`, `filename`, `mimetype`, `size` etc.
 */
export async function up(mongoose: Mongoose) {
  logger.info("[016] Centralizing uploads...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("[016] No db connection");

  const collections = (await db.listCollections().toArray()).map((c) => c.name);
  const dstUploads = db.collection("uploads");

  await dstUploads.createIndex({ uploadedBy: 1 });
  await dstUploads.createIndex({ folder: 1 });
  await dstUploads.createIndex({ createdAt: -1 });

  // ── Step 1: materials ──────────────────────────

  if (collections.includes("materials")) {
    const materialsCol = db.collection("materials");
    const materials = materialsCol.find({ url: { $exists: true } });

    const getMimeType = (type: string) => {
      switch (type) {
        case "pdf":
          return "application/pdf";
        case "doc":
          return "application/msword";
        case "slides":
          return "application/vnd.ms-powerpoint";
        case "text":
          return "text/plain";
        case "img":
          return "image/jpeg";
        case "link":
          return "text/uri-list";
        case "data":
          return "application/json";
        default:
          return "application/octet-stream";
      }
    };

    let count = 0;
    for await (const doc of materials) {
      if (!doc.url) continue;

      if (doc.type === "link") {
        await materialsCol.updateOne(
          { _id: doc._id },
          {
            $set: { externalUrl: doc.url },
            $unset: { url: "" },
          },
        );
      } else {
        const uploadResult = await dstUploads.insertOne({
          url: doc.url,
          originalFilename: doc.title || "material_file",
          mimetype: getMimeType(doc.type),
          size: 0,
          folder: "materials",
          uploadedBy: doc.uploadedBy,
          createdAt: doc.createdAt || new Date(),
          updatedAt: doc.updatedAt || new Date(),
        });

        await materialsCol.updateOne(
          { _id: doc._id },
          {
            $set: { upload: uploadResult.insertedId },
            $unset: { url: "" },
          },
        );
      }
      count++;
    }
    logger.info(`[016] Migrated ${count} materials to use uploads.`);
  }

  // ── Step 2: emailcampaignimages ──────────────────────────

  if (collections.includes("emailcampaignimages")) {
    const imagesCol = db.collection("emailcampaignimages");
    const images = imagesCol.find({ url: { $exists: true } });

    let count = 0;
    for await (const doc of images) {
      if (!doc.url) continue;

      const uploadResult = await dstUploads.insertOne({
        url: doc.url,
        originalFilename: doc.filename || "image_file",
        mimetype: doc.mimetype || "image/unknown",
        size: doc.size || 0,
        folder: "email_campaigns",
        uploadedBy: doc.createdBy,
        createdAt: doc.createdAt || new Date(),
        updatedAt: doc.updatedAt || new Date(),
      });

      await imagesCol.updateOne(
        { _id: doc._id },
        {
          $set: { upload: uploadResult.insertedId },
          $unset: { url: "", filename: "", mimetype: "", size: "" },
        },
      );
      count++;
    }
    logger.info(
      `[016] Migrated ${count} email campaign images to use uploads.`,
    );
  }

  logger.info("[016] Migration complete.");
}
