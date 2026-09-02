import { Mongoose } from "mongoose";
import { nanoid } from "nanoid";
import { logger } from "@/config";

/**
 * Migration 051: Migrate Legacy Directives to Persistent Artifacts.
 *
 * Converts legacy directive messages into persistent artifact references.
 * Ensures messages link to an artifactId with type "directive" / "artifact".
 */
export async function up(mongoose: Mongoose) {
  logger.info("Starting migration: 051_migrate_directives_to_artifacts...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("No active DB connection");

  const sessionsCollection = db.collection("studysessions");

  const cursor = sessionsCollection.find({
    "messages.type": "directive",
  });

  let migratedSessionsCount = 0;
  let migratedDirectivesCount = 0;

  while (await cursor.hasNext()) {
    const session = await cursor.next();
    if (!session || !Array.isArray(session.messages)) continue;

    const newArtifacts = [...(session.artifacts || [])];
    let modified = false;

    const updatedMessages = session.messages.map((m: any) => {
      if (m.type !== "directive" || !m.directive) return m;

      const artifactId = nanoid();
      const directiveType = (m.directive.type || "ask_question").toLowerCase();
      const payload = m.directive.payload || {};

      newArtifacts.push({
        artifactId,
        type: "directive",
        title: `Interactive ${m.directive.type || "Directive"}`,
        content: {
          directiveType,
          payload,
          status: "answered",
          respondedAt: m.timestamp || new Date(),
        },
        phase: m.phase || session.currentPhase || "implementation",
        createdAt: m.timestamp || new Date(),
        updatedAt: m.timestamp || new Date(),
      });

      migratedDirectivesCount++;
      modified = true;

      return {
        ...m,
        type: "artifact",
        artifactId,
      };
    });

    if (modified) {
      await sessionsCollection.updateOne(
        { _id: session._id },
        {
          $set: {
            messages: updatedMessages,
            artifacts: newArtifacts,
          },
        },
      );
      migratedSessionsCount++;
    }
  }

  logger.info(
    `Migration 051 complete. Migrated ${migratedDirectivesCount} directives across ${migratedSessionsCount} sessions.`,
  );
}

export async function down(mongoose: Mongoose) {
  logger.info("Rollback 051: Keeping artifact references in place.");
}
