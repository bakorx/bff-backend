import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 009: Seed an empty LearnerProfile document for every user that
 * does not already have one.
 *
 * The recommendation engine requires a LearnerProfile to exist for each user
 * before it can run.  New users get a profile created on signup, but existing
 * users need to have one back-filled.
 *
 * The profile is intentionally empty:
 *   - topicAffinities = []
 *   - weakAreas = []
 *   - dismissedContentIds = []
 *   - completedContentIds = []
 *   - abandonedContentIds = []
 *   - overallAverageScore = 0
 *   - lastProfileUpdate = epoch (0) → the nightly rebuild job will populate it
 *     on its first run.
 *
 * Rollback: db.learnerprofiles.drop()
 */
export async function up(mongoose: Mongoose) {
  logger.info(
    "[009] Seeding empty LearnerProfile documents for existing users...",
  );

  const db = mongoose.connection.db;
  if (!db) {
    logger.info("[009] No db object available. Ensure mongoose is connected.");
    return;
  }

  const usersCol = db.collection("users");
  const campusesCol = db.collection("campuses");
  const learnerProfilesCol = db.collection("learnerprofiles");

  // Build a campusId → universityId lookup map
  const campusMap = new Map<string, unknown>();
  const campusCursor = campusesCol.find(
    { universityId: { $exists: true } },
    { projection: { _id: 1, universityId: 1 } },
  );
  for await (const campus of campusCursor) {
    if (campus.universityId) {
      campusMap.set(campus._id.toString(), campus.universityId);
    }
  }

  // Build a set of userIds that already have a LearnerProfile
  const existingCursor = learnerProfilesCol.find(
    {},
    { projection: { userId: 1 } },
  );
  const existingUserIds = new Set<string>();
  for await (const doc of existingCursor) {
    if (doc.userId) existingUserIds.add(doc.userId.toString());
  }

  // Iterate over all users and insert a profile where missing
  const usersCursor = usersCol.find(
    { isDeleted: { $ne: true } },
    { projection: { _id: 1, campusId: 1 } },
  );

  const batch: object[] = [];
  const BATCH_SIZE = 500;

  async function flushBatch() {
    if (batch.length === 0) return;
    await learnerProfilesCol.insertMany(batch);
    batch.length = 0;
  }

  let seeded = 0;
  let skipped = 0;

  for await (const user of usersCursor) {
    if (existingUserIds.has(user._id.toString())) {
      skipped++;
      continue;
    }

    batch.push({
      userId: user._id,
      campusId: user.campusId ?? null,
      universityId: user.campusId
        ? (campusMap.get(user.campusId.toString()) ?? null)
        : null,
      topicAffinities: [],
      weakAreas: [],
      dismissedContentIds: [],
      completedContentIds: [],
      abandonedContentIds: [],
      overallAverageScore: 0,
      lastProfileUpdate: new Date(0),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    seeded++;

    if (batch.length >= BATCH_SIZE) {
      await flushBatch();
    }
  }

  await flushBatch();

  logger.info(`[009] Done. Seeded: ${seeded}, already existed: ${skipped}.`);
}
