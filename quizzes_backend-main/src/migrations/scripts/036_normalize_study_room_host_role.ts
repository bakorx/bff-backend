import { Mongoose, ObjectId } from "mongoose";
import { logger } from "@/config";

type StudyRoomParticipant = {
  userId?: ObjectId;
  guestId?: string;
  displayName?: string;
  role?: string;
  joinedAt?: Date;
  points?: number;
  xp?: number;
  level?: number;
  completedCycles?: number;
  lastActiveAt?: Date;
  leftAt?: Date;
};

type StudyRoomDoc = {
  _id: ObjectId;
  hostId: ObjectId;
  participants?: StudyRoomParticipant[];
};

/**
 * Migration 036: Normalize study room ownership role to "host".
 *
 * What this migration does:
 * 1) Converts legacy participants.role="owner" to "host"
 * 2) Ensures each room hostId has a host participant row
 * 3) Demotes non-host users that still have role="host" to "member"
 *
 * Notes:
 * - Idempotent and safe to re-run.
 * - Uses hostId as source of truth for room ownership.
 */
export async function up(mongoose: Mongoose) {
  logger.info("[036] Normalizing study room ownership role to host...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("[036] No active DB connection");

  const studyRooms = db.collection<StudyRoomDoc>("studyrooms");
  const now = new Date();

  const ownerToHostResult = await studyRooms.updateMany(
    { "participants.role": "owner" },
    { $set: { "participants.$[participant].role": "host" } },
    { arrayFilters: [{ "participant.role": "owner" }] },
  );

  const rooms = await studyRooms
    .find({}, { projection: { hostId: 1, participants: 1 } })
    .toArray();

  let hostParticipantInserted = 0;
  let hostParticipantPromoted = 0;
  let nonHostDemoted = 0;

  for (const room of rooms) {
    const participants = room.participants || [];
    const hostId = String(room.hostId);

    let hasHostParticipant = false;

    const updatedParticipants = participants.map((participant) => {
      const participantUserId = participant.userId
        ? String(participant.userId)
        : "";
      if (participantUserId === hostId) {
        hasHostParticipant = true;
        if (participant.role !== "host") {
          hostParticipantPromoted += 1;
          return { ...participant, role: "host" };
        }
        return participant;
      }

      if (participant.role === "host") {
        nonHostDemoted += 1;
        return { ...participant, role: "member" };
      }

      return participant;
    });

    if (!hasHostParticipant) {
      hostParticipantInserted += 1;
      updatedParticipants.push({
        userId: room.hostId,
        displayName: "Host",
        role: "host",
        joinedAt: now,
        points: 0,
        xp: 0,
        level: 1,
        completedCycles: 0,
        lastActiveAt: now,
      });
    }

    await studyRooms.updateOne(
      { _id: room._id },
      { $set: { participants: updatedParticipants } },
    );
  }

  logger.info(
    `[036] Done. owner->host updates=${ownerToHostResult.modifiedCount}, host promoted=${hostParticipantPromoted}, host inserted=${hostParticipantInserted}, non-host demoted=${nonHostDemoted}`,
  );
}

export async function down(_mongoose: Mongoose) {
  logger.info("[036] Down migration is a no-op.");
}
