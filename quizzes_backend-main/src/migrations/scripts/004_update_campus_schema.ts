import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration: Back-fill `universityId` on Campus documents and remove stale fields.
 *
 * Background:
 *   The old CampusSchema referenced its parent institution via an informal `schoolId`
 *   field (evidenced by the old `CampusSchema.index({schoolId: 1})` index).
 *   The new schema requires an explicit `universityId` reference.
 *   After migration 003, old School _ids now exist in the `universities` collection,
 *   so we can safely copy `schoolId` → `universityId` on each campus — but only after
 *   validating that the target university document actually exists.
 *
 *   Stale fields no longer in ICampus: `allowResourceSharing`, `sharedWithCampuses`, `admins`.
 *
 * Rollback: $rename universityId → schoolId, $set the stale fields back (data for
 *   allowResourceSharing / admins / sharedWithCampuses is unrecoverable after unset).
 */
export async function up(mongoose: Mongoose) {
  logger.info(
    "Back-filling universityId and removing stale fields from campuses...",
  );

  const db = mongoose.connection.db;
  if (!db) {
    logger.info("No db object available. Ensure mongoose is connected.");
    return;
  }

  const campusesCollection = db.collection("campuses");
  const universitiesCollection = db.collection("universities");

  // Build a Set of valid university IDs in a single query so we can validate each
  // campus's schoolId without an N+1 pattern.
  const universityDocs = await universitiesCollection
    .find({}, { projection: { _id: 1 } })
    .toArray();
  const validUniversityIds = new Set(
    universityDocs.map((u) => u._id.toString()),
  );

  // Step 1: For each campus that has a schoolId but no universityId, copy the
  //         reference only when the target university exists.
  let backfilled = 0;
  let orphaned = 0;

  const campusCursor = campusesCollection.find({
    schoolId: { $exists: true },
    universityId: { $exists: false },
  });

  for await (const campus of campusCursor) {
    const schoolIdStr = campus.schoolId?.toString();
    if (!schoolIdStr || !validUniversityIds.has(schoolIdStr)) {
      // The old schoolId does not correspond to a promoted university.
      // Log a warning but do not create a dangling reference — the campus will
      // need its universityId assigned manually via the application.
      logger.info(
        `Campus ${campus._id} has schoolId ${campus.schoolId} which was not found in the universities collection. Skipping universityId back-fill for this document.`,
      );
      orphaned++;
      continue;
    }

    await campusesCollection.updateOne(
      { _id: campus._id },
      { $set: { universityId: campus.schoolId } },
    );
    backfilled++;
  }

  logger.info(
    `Back-filled universityId on ${backfilled} campus document(s). ${orphaned} campus document(s) had unresolvable schoolId references and were skipped.`,
  );

  // Step 2: Remove stale fields that are no longer part of ICampus.
  const cleanupResult = await campusesCollection.updateMany(
    {
      $or: [
        { allowResourceSharing: { $exists: true } },
        { sharedWithCampuses: { $exists: true } },
        { admins: { $exists: true } },
        { schoolId: { $exists: true } },
      ],
    },
    {
      $unset: {
        allowResourceSharing: "",
        sharedWithCampuses: "",
        admins: "",
        schoolId: "",
      },
    },
  );

  logger.info(
    `Removed stale fields from ${cleanupResult.modifiedCount} campus document(s).`,
  );
}
