import { Mongoose } from "mongoose";
import { logger } from "@/config";

export const dependsOn = ["041_remove_question_type_prefixes"];

export async function up(mongoose: Mongoose) {
  logger.info("Starting migration: 042_backfill_material_processing_flags...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("[042] No db connection");

  const collections = (await db.listCollections().toArray()).map((c) => c.name);

  if (!collections.includes("materials")) {
    logger.info("[042] materials collection not found; skipping.");
    return;
  }

  const materialsCollection = db.collection("materials");
  let materialsUpdated = 0;

  // 1. Backfill contentType — every material that lacks it gets "material" as default.
  //    If the document already has parsedQuestions with entries it gets "questions".
  const cursor = materialsCollection.find({
    $or: [{ contentType: { $exists: false } }, { contentType: null }],
  });

  for await (const doc of cursor) {
    const hasParsedQuestions =
      Array.isArray(doc.parsedQuestions) && doc.parsedQuestions.length > 0;

    const patch: Record<string, unknown> = {
      contentType: hasParsedQuestions ? "questions" : "material",
    };

    // Normalize quizGenerated / flashcardsGenerated to booleans in case they
    // were written as raw values by findByIdAndUpdate before the schema had them.
    if (doc.quizGenerated === undefined || doc.quizGenerated === null) {
      patch.quizGenerated = false;
    }
    if (
      doc.flashcardsGenerated === undefined ||
      doc.flashcardsGenerated === null
    ) {
      patch.flashcardsGenerated = false;
    }

    await materialsCollection.updateOne({ _id: doc._id }, { $set: patch });
    materialsUpdated++;
  }

  logger.info(
    `[042] Backfilled contentType on ${materialsUpdated} material documents.`,
  );

  // 2. For published LibraryMaterial documents — cross-reference the underlying
  //    Material to see if quiz generation has already run, and mark accordingly.
  if (!collections.includes("librarymaterials")) {
    logger.info(
      "[042] librarymaterials collection not found; skipping library backfill.",
    );
    return;
  }

  const libraryCollection = db.collection("librarymaterials");
  let libraryUpdated = 0;

  const libraryCursor = libraryCollection.find({
    status: "published",
    $or: [{ quizGenerated: { $exists: false } }, { quizGenerated: null }],
  });

  for await (const libDoc of libraryCursor) {
    const underlyingMaterial = await materialsCollection.findOne({
      _id: libDoc.materialId,
    });

    if (!underlyingMaterial) continue;

    const patch: Record<string, unknown> = {
      quizGenerated: underlyingMaterial.quizGenerated === true,
    };

    if (underlyingMaterial.quizGeneratedAt) {
      patch.quizGeneratedAt = underlyingMaterial.quizGeneratedAt;
    }

    await libraryCollection.updateOne({ _id: libDoc._id }, { $set: patch });
    libraryUpdated++;
  }

  logger.info(
    `[042] Backfilled quizGenerated flag on ${libraryUpdated} LibraryMaterial documents.`,
  );
  logger.info(
    `[042] Migration complete. materialsUpdated=${materialsUpdated}, libraryUpdated=${libraryUpdated}`,
  );
}

export async function down(mongoose: Mongoose) {
  logger.info(
    "Down migration for 042: Removing backfilled contentType and quizGenerated fields from materials and librarymaterials.",
  );

  const db = mongoose.connection.db;
  if (!db) throw new Error("[042] No db connection");

  const collections = (await db.listCollections().toArray()).map((c) => c.name);

  if (collections.includes("materials")) {
    await db.collection("materials").updateMany(
      {},
      {
        $unset: {
          contentType: "",
          quizGenerated: "",
          quizGeneratedAt: "",
          flashcardsGenerated: "",
          flashcardsGeneratedAt: "",
        },
      },
    );
  }

  if (collections.includes("librarymaterials")) {
    await db
      .collection("librarymaterials")
      .updateMany({}, { $unset: { quizGenerated: "", quizGeneratedAt: "" } });
  }

  logger.info("[042] Down migration complete.");
}
