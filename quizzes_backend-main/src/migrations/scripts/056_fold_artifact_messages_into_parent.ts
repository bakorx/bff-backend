import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 056: Fold standalone artifact messages into their parent Z text message.
 *
 * Background: Skills (ask_question, create_exposition, create_recap, etc.) called
 * ArtifactServices.save() which pushed a separate { role: "z", type: "artifact" }
 * message into session.messages for every artifact created.  The serializer (055+)
 * now folds those rows into the nearest preceding role:"z" / type:"text" message at
 * read time, but the DB still contains the redundant standalone rows.
 *
 * This migration:
 *   1. Iterates every session that has at least one type:"artifact" message.
 *   2. Builds an artifact lookup from session.artifacts[].
 *   3. In a single pass, attaches each artifact payload to the nearest preceding
 *      role:"z" / type:"text" message (if not already attached) and removes the
 *      standalone artifact row.
 *   4. Writes the compacted messages array back to the DB in one atomic update.
 *
 * Rollback: No-op — the serializer already handles the legacy shape gracefully,
 * so reverting the DB write isn't required. A manual restore from backup is the
 * only way to undo if needed.
 */
export async function up(mongoose: Mongoose) {
  logger.info("Starting migration: 056_fold_artifact_messages_into_parent...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("No active DB connection");

  const sessionsCollection = db.collection("studysessions");

  // Only process sessions that still have at least one standalone artifact message
  const cursor = sessionsCollection.find({
    "messages.type": "artifact",
  });

  let totalSessionsChecked = 0;
  let totalSessionsModified = 0;
  let totalArtifactsFolded = 0;
  let totalArtifactsOrphaned = 0;

  while (await cursor.hasNext()) {
    const session = await cursor.next();
    if (!session || !Array.isArray(session.messages)) continue;

    totalSessionsChecked++;

    // ── Build artifact lookup from session.artifacts ──────────────────────────
    const artifactById = new Map<string, any>();
    if (Array.isArray(session.artifacts)) {
      for (const art of session.artifacts) {
        if (art?.artifactId) artifactById.set(art.artifactId, art);
      }
    }

    // ── Bidirectional turn-based fold ────────────────────────────────────────
    const output: any[] = [];
    const absorbedArtifactIndices = new Set<number>();
    const messages = session.messages;
    let modified = false;

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (!m) continue;
      const type = m.type || "text";

      if (m.role === "z" && (type === "text" || !type)) {
        let artifactPayload = m.artifact;
        let artifactId = m.artifactId;

        if (!artifactPayload && artifactId) {
          artifactPayload = artifactById.get(artifactId);
        }

        // Look for unabsorbed companion artifact in the same turn
        if (!artifactPayload) {
          // Look backward
          for (let j = i - 1; j >= 0; j--) {
            const prev = messages[j];
            if (!prev) continue;
            if (prev.role === "user") break;
            if (prev.type === "artifact" && !absorbedArtifactIndices.has(j)) {
              artifactPayload =
                prev.artifact || (prev.artifactId ? artifactById.get(prev.artifactId) : null);
              artifactId = prev.artifactId || artifactPayload?.artifactId;
              if (artifactPayload) {
                absorbedArtifactIndices.add(j);
                totalArtifactsFolded++;
                modified = true;
                break;
              }
            }
          }

          // Look forward
          if (!artifactPayload) {
            for (let j = i + 1; j < messages.length; j++) {
              const next = messages[j];
              if (!next) continue;
              if (next.role === "user") break;
              if (next.type === "artifact" && !absorbedArtifactIndices.has(j)) {
                artifactPayload =
                  next.artifact || (next.artifactId ? artifactById.get(next.artifactId) : null);
                artifactId = next.artifactId || artifactPayload?.artifactId;
                if (artifactPayload) {
                  absorbedArtifactIndices.add(j);
                  totalArtifactsFolded++;
                  modified = true;
                  break;
                }
              }
            }
          }
        }

        output.push({
          ...m,
          artifactId: artifactId || m.artifactId || undefined,
          artifact: artifactPayload || m.artifact || undefined,
        });
      } else if (type === "artifact") {
        if (absorbedArtifactIndices.has(i)) {
          continue; // Folded into companion text message!
        }

        // Check if there is a companion Z text message in the same turn that will absorb this
        let willBeAbsorbed = false;
        for (let j = i + 1; j < messages.length; j++) {
          const next = messages[j];
          if (!next) continue;
          if (next.role === "user") break;
          if (next.role === "z" && (next.type === "text" || !next.type)) {
            willBeAbsorbed = true;
            break;
          }
        }
        if (!willBeAbsorbed) {
          for (let j = i - 1; j >= 0; j--) {
            const prev = messages[j];
            if (!prev) continue;
            if (prev.role === "user") break;
            if (prev.role === "z" && (prev.type === "text" || !prev.type)) {
              willBeAbsorbed = true;
              break;
            }
          }
        }

        if (!willBeAbsorbed) {
          // Standalone artifact without companion text message
          let artifactPayload = m.artifact ?? null;
          if (!artifactPayload && m.artifactId) {
            artifactPayload = artifactById.get(m.artifactId) ?? null;
          }

          if (!artifactPayload) {
            totalArtifactsOrphaned++;
            modified = true;
            continue;
          }

          output.push({
            ...m,
            artifact: artifactPayload,
            artifactId: m.artifactId || artifactPayload.artifactId,
          });
        }
      } else {
        output.push(m);
      }
    }

    if (modified) {
      await sessionsCollection.updateOne(
        { _id: session._id },
        { $set: { messages: output } },
      );
      totalSessionsModified++;
    }
  }

  logger.info(
    `Migration 056 complete. ` +
      `Checked ${totalSessionsChecked} sessions, ` +
      `modified ${totalSessionsModified} sessions, ` +
      `folded ${totalArtifactsFolded} artifact messages, ` +
      `dropped ${totalArtifactsOrphaned} orphaned artifact messages.`,
  );
}

export async function down(mongoose: Mongoose) {
  // The serializer handles both the old (standalone artifact row) and new
  // (artifact folded into text message) shapes, so no rollback is needed.
  logger.info("Rollback 056: No-op — serializer handles both DB shapes.");
}
