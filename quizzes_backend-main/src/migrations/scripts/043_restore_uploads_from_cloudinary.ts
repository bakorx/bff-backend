import { Mongoose } from "mongoose";
import { v2 as cloudinary } from "cloudinary";
import { logger } from "@/config";

export const dependsOn = ["042_backfill_material_processing_flags"];

/**
 * Migration 043: Restore deleted uploads collection from Cloudinary
 *
 * What happened:
 *  - The `uploads` collection was accidentally deleted.
 *  - All files still exist in Cloudinary (e.g. https://res.cloudinary.com/…/materials/<uuid>.pdf).
 *  - The `materials` collection is intact but each document's `upload` ref is dangling.
 *  - User `profilePicture` refs are also dangling — cleared here, users re-upload.
 *  - Old Firebase-era materials (untitled + never processed) are deleted.
 *
 * Matching strategy (why not by filename):
 *  The multer config sets public_id to a random UUID, so Cloudinary's
 *  original_filename is also that UUID — never the user's original filename.
 *  Instead we match on: bytes (exact) + format (from mimeType) + created_at proximity.
 *  Each Cloudinary asset is consumed once — no asset is reused across materials.
 *
 * Steps:
 *  1. Delete Firebase-era materials (untitled + unprocessed).
 *  2. Fetch all Cloudinary assets from the "materials/" folder.
 *  3. For each Material with a dangling upload ref, find the best-matching
 *     unused Cloudinary asset: exact size + format, closest timestamp.
 *  4. Create an Upload document and patch the Material's `upload` field.
 *  5. Null out dangling `profilePicture` refs on User documents.
 */
export async function up(mongoose: Mongoose) {
  logger.info("[043] Restoring uploads collection from Cloudinary...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("[043] No db connection");

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
    api_key: process.env.CLOUDINARY_API_KEY!,
    api_secret: process.env.CLOUDINARY_API_SECRET!,
  });

  const materialsCol = db.collection("materials");
  const uploadsCol = db.collection("uploads");
  const usersCol = db.collection("users");

  // ── 1. Delete Firebase-era materials ────────────────────────────────────────
  // Drop ALL materials with no real name — these are Firebase leftovers.
  // No processingStatus guard: if the name is untitled, it's garbage regardless.
  const firebaseDeleteResult = await materialsCol.deleteMany({
    $or: [
      { originalName: { $regex: /^untitled$/i } },
      { originalName: "" },
      { originalName: { $exists: false } },
      { filename: { $regex: /^untitled$/i } },
      { filename: "" },
      { filename: { $exists: false } },
    ],
  });
  logger.info(
    `[043] Deleted ${firebaseDeleteResult.deletedCount} Firebase-era material(s).`,
  );

  // ── 2. Fetch all Cloudinary assets in the "materials/" folder ────────────────
  logger.info("[043] Fetching Cloudinary assets...");
  const allAssets: CloudinaryAsset[] = [];

  for (const resourceType of ["raw", "image", "video"] as const) {
    let nextCursor: string | undefined;
    do {
      const result: any = await cloudinary.api.resources({
        type: "upload",
        prefix: "materials/",
        resource_type: resourceType,
        max_results: 500,
        ...(nextCursor ? { next_cursor: nextCursor } : {}),
      });
      allAssets.push(...result.resources);
      nextCursor = result.next_cursor;
    } while (nextCursor);
  }

  logger.info(`[043] Found ${allAssets.length} Cloudinary asset(s).`);

  // Pool of unmatched assets — each asset can only be assigned once
  const assetPool = new Map<string, CloudinaryAsset>(
    allAssets.map((a) => [a.public_id, a]),
  );

  // ── 3. Match and restore materials ──────────────────────────────────────────
  const allMaterials = await materialsCol.find({}).toArray();
  logger.info(`[043] Processing ${allMaterials.length} material(s)...`);

  let restored = 0;
  let alreadyOk = 0;
  const unmatched: string[] = [];

  for (const mat of allMaterials) {
    // Skip if upload ref already resolves to an existing Upload document
    if (mat.upload) {
      const existingUpload = await uploadsCol.findOne({ _id: mat.upload });
      if (existingUpload) {
        alreadyOk++;
        continue;
      }
    }

    const expectedFormat = mimeToFormat(mat.mimeType ?? "");
    const expectedSize: number = mat.size ?? 0;
    const uploadedAt = mat.uploadedAt
      ? new Date(mat.uploadedAt).getTime()
      : null;

    // Find candidates from the remaining pool: exact size + matching format
    const candidates = Array.from(assetPool.values()).filter((a) => {
      const sizeMatch = a.bytes === expectedSize;
      const formatMatch = !expectedFormat || a.format === expectedFormat;
      return sizeMatch && formatMatch;
    });

    let best: CloudinaryAsset | null = null;

    if (candidates.length === 1) {
      best = candidates[0];
    } else if (candidates.length > 1) {
      // Multiple candidates with same size+format — pick closest upload time
      if (uploadedAt !== null) {
        best = candidates.reduce((prev, curr) => {
          const dPrev = Math.abs(
            new Date(prev.created_at).getTime() - uploadedAt,
          );
          const dCurr = Math.abs(
            new Date(curr.created_at).getTime() - uploadedAt,
          );
          return dCurr < dPrev ? curr : prev;
        });
      } else {
        // No timestamp to compare — pick most recently uploaded asset
        best = candidates.reduce((prev, curr) =>
          new Date(curr.created_at) > new Date(prev.created_at) ? curr : prev,
        );
      }
    }

    if (!best) {
      // Fallback: size-only match (ignore format mismatch — Cloudinary can re-classify types)
      const sizeOnlyCandidates = Array.from(assetPool.values()).filter(
        (a) => a.bytes === expectedSize,
      );

      if (sizeOnlyCandidates.length > 0) {
        best =
          uploadedAt !== null
            ? sizeOnlyCandidates.reduce((prev, curr) => {
                const dPrev = Math.abs(
                  new Date(prev.created_at).getTime() - uploadedAt,
                );
                const dCurr = Math.abs(
                  new Date(curr.created_at).getTime() - uploadedAt,
                );
                return dCurr < dPrev ? curr : prev;
              })
            : sizeOnlyCandidates[0];

        logger.info(
          `[043] ⚠ Format mismatch for material ${mat._id} ("${mat.originalName}"): ` +
            `expected "${expectedFormat}", got "${best.format}". Matched by size+time only.`,
        );
      }
    }

    if (!best) {
      logger.info(
        `[043] ✗ No match for material ${mat._id} ("${mat.originalName || mat.filename}", ` +
          `${expectedSize} bytes, ${expectedFormat})`,
      );
      unmatched.push(String(mat._id));
      continue;
    }

    // Consume this asset from the pool so it won't be reused
    assetPool.delete(best.public_id);

    // Create Upload document
    const { insertedId } = await uploadsCol.insertOne({
      url: best.secure_url,
      originalFilename: mat.originalName || mat.filename,
      mimetype: mat.mimeType,
      size: mat.size,
      folder: "materials",
      uploadedBy: mat.uploadedBy ?? null,
      createdAt: mat.uploadedAt ? new Date(mat.uploadedAt) : new Date(),
      updatedAt: new Date(),
    });

    // Patch material's upload ref
    await materialsCol.updateOne(
      { _id: mat._id },
      { $set: { upload: insertedId } },
    );

    logger.info(
      `[043] ✓ ${mat._id} "${mat.originalName || mat.filename}" → ${best.secure_url}`,
    );
    restored++;
  }

  // ── 4. Clear dangling profilePicture refs ────────────────────────────────────
  // User only stored the Upload ObjectId — no filename/size to match against
  // Cloudinary avatars — so we clear the refs and let users re-upload.
  const usersWithPic = await usersCol
    .find({ profilePicture: { $exists: true, $ne: null } })
    .toArray();

  let avatarsCleared = 0;
  for (const user of usersWithPic) {
    const existingUpload = await uploadsCol.findOne({
      _id: user.profilePicture,
    });
    if (!existingUpload) {
      await usersCol.updateOne(
        { _id: user._id },
        { $unset: { profilePicture: "" } },
      );
      avatarsCleared++;
    }
  }
  logger.info(
    `[043] Cleared ${avatarsCleared} dangling profilePicture ref(s) — users must re-upload avatars.`,
  );

  // ── 5. Summary ───────────────────────────────────────────────────────────────
  const unusedAssets = Array.from(assetPool.values());
  logger.info(`\n[043] ═══════════════════════════════════`);
  logger.info(
    `[043] Firebase leftovers deleted: ${firebaseDeleteResult.deletedCount}`,
  );
  logger.info(`[043] Uploads restored:           ${restored}`);
  logger.info(`[043] Already had valid upload:   ${alreadyOk}`);
  logger.info(`[043] Unmatched materials:        ${unmatched.length}`);
  logger.info(`[043] Avatar refs cleared:        ${avatarsCleared}`);
  logger.info(`[043] Unused Cloudinary assets:   ${unusedAssets.length}`);

  if (unmatched.length > 0) {
    logger.info(`\n[043] Unmatched material IDs (manual fix needed):`);
    unmatched.forEach((id) => logger.info(`         - ${id}`));
  }
  if (unusedAssets.length > 0) {
    logger.info(`\n[043] Cloudinary assets not matched to any material:`);
    unusedAssets.forEach((a) =>
      logger.info(
        `         - ${a.public_id} (${a.bytes}B, ${a.format}, ${a.created_at})`,
      ),
    );
  }
  logger.info(`\n[043] ═══════════════════════════════════`);
  logger.info("[043] Migration complete.");
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Map a MIME type to the format string Cloudinary uses in asset metadata. */
function mimeToFormat(mimeType: string): string {
  const map: Record<string, string> = {
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "docx",
    "application/vnd.ms-powerpoint": "ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      "pptx",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "text/plain": "txt",
    "application/rtf": "rtf",
    "application/json": "json",
  };
  return map[mimeType] ?? "";
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface CloudinaryAsset {
  public_id: string;
  secure_url: string;
  url: string;
  original_filename: string;
  bytes: number;
  format: string;
  resource_type: string;
  created_at: string;
}
