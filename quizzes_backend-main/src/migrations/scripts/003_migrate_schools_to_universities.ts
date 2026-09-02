import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration: Promote old top-level `schools` documents → new `universities` collection.
 *
 * Background:
 *   The old data model used a single `schools` collection as the root institution
 *   (it carried `campuses`, `logo`, `website`, `description`, and flat `settings`).
 *   The new hierarchy is: University → Campus → College → School → Department.
 *   Old School ≈ new University.
 *
 * Strategy:
 *   • For every document in `schools` that has university-level fields
 *     (logo, website, or the old settings shape), copy it to the `universities`
 *     collection **keeping the same `_id`** so that existing campus references
 *     (via the old `schoolId` field) still resolve.
 *   • Map the old `settings` sub-document to the new `IUniversityOnlySettings` shape.
 *   • Skip documents that have already been copied (idempotent — checked via a
 *     pre-built Set for O(1) lookup rather than per-document queries).
 *
 * Rollback: drop documents from `universities` whose `_id` appears in `schools`.
 */
export async function up(mongoose: Mongoose) {
  logger.info(
    "Promoting old school documents to the universities collection...",
  );

  const db = mongoose.connection.db;
  if (!db) {
    logger.info("No db object available. Ensure mongoose is connected.");
    return;
  }

  const schoolsCollection = db.collection("schools");
  const universitiesCollection = db.collection("universities");

  // Pre-fetch all existing university IDs in one query for O(1) idempotency checks.
  const existingUniversities = await universitiesCollection
    .find({}, { projection: { _id: 1 } })
    .toArray();
  const existingIds = new Set(
    existingUniversities.map((u) => u._id.toString()),
  );

  let promoted = 0;
  let skipped = 0;

  // Only target documents that still carry old university-level fields.
  const cursor = schoolsCollection.find({
    $or: [
      { logo: { $exists: true } },
      { website: { $exists: true } },
      { campuses: { $exists: true } },
      { description: { $exists: true } },
      { "settings.allowCrossSchoolSharing": { $exists: true } },
    ],
  });

  for await (const school of cursor) {
    if (existingIds.has(school._id.toString())) {
      skipped++;
      continue;
    }

    const oldSettings = school.settings ?? {};

    // The old `allowCrossSchoolSharing` maps to the institution-level flag that
    // controls whether content can be shared across the university's own schools.
    // It is surfaced both in:
    //   • settings.allowCrossInstitutionSharing — governs cross-institution (external) sharing
    //   • sharingSettings.allowCrossSchoolSharing — governs cross-school sharing within this university
    const allowCrossSchool: boolean =
      oldSettings.allowCrossSchoolSharing ?? false;

    const newSettings = {
      requireEmailVerification: oldSettings.requireEmailVerification ?? true,
      defaultStudentCredits: oldSettings.defaultStudentCredits ?? 1200,
      // allowCrossSchoolSharing in old model = allow sharing across schools within the university.
      // Map to allowCrossInstitutionSharing in the new settings shape.
      allowCrossInstitutionSharing: allowCrossSchool,
    };

    const sharingSettings = {
      allowCrossCampusSharing: false,
      allowCrossCollegeSharing: false,
      allowCrossSchoolSharing: allowCrossSchool,
      allowCrossDeptSharing: false,
    };

    const universityDoc: Record<string, unknown> = {
      _id: school._id,
      name: school.name,
      code: school.code,
      description: school.description,
      logo: school.logo,
      website: school.website,
      isActive: school.isActive ?? true,
      settings: newSettings,
      sharingSettings,
      targetedPolicies: [],
      createdAt: school.createdAt ?? new Date(),
      updatedAt: new Date(),
    };

    await universitiesCollection.insertOne(universityDoc);
    existingIds.add(school._id.toString()); // keep set in sync for subsequent iterations
    promoted++;
  }

  logger.info(
    `Promoted ${promoted} school(s) to universities. Skipped ${skipped} already-migrated document(s).`,
  );
}
