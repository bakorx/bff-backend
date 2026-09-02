import { Mongoose } from "mongoose";
import { logger } from "@/config";
import { nanoid } from "nanoid";

/**
 * Migration 065: Convert raw text citations (e.g. "(Source: DCIT 403 ..., p. 2)")
 * inside lesson/exposition artifacts and messages into structured citation objects.
 *
 * This strips raw markdown citation strings from artifact body text and ensures
 * artifacts have a structured `citations: [...]` array linking to the proper material.
 */
export async function up(mongoose: Mongoose) {
  logger.info("Starting migration: 065_convert_text_citations_to_artifacts...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("No active DB connection");

  const sessionsCollection = db.collection("studysessions");
  const materialsCollection = db.collection("materials");

  // Match sessions having artifacts with raw source references
  const cursor = sessionsCollection.find({
    $or: [
      { "artifacts.content.body": { $regex: /\((?:Source|Ref):/i } },
      { "artifacts.content.explanation": { $regex: /\((?:Source|Ref):/i } },
      { "messages.content": { $regex: /\((?:Source|Ref):/i } },
    ],
  });

  let totalSessionsChecked = 0;
  let totalSessionsModified = 0;
  let totalCitationsConverted = 0;

  const SOURCE_REGEX = /\s*\((?:Source|Ref):\s*([^,)]+)(?:,\s*Chapter\s*[^,)]+)?(?:,\s*p(?:p)?\.?\s*(\d+))?.*?\)\s*$/im;

  while (await cursor.hasNext()) {
    const session = await cursor.next();
    if (!session) continue;

    totalSessionsChecked++;
    let sessionModified = false;

    // Load available materials for this session
    const sessionMaterialIds = Array.isArray(session.materialIds)
      ? session.materialIds
      : [];
    const availableMaterials = await materialsCollection
      .find({
        _id: { $in: sessionMaterialIds },
      })
      .project({ _id: 1, filename: 1, title: 1 })
      .toArray();

    const defaultMaterial = availableMaterials[0] || null;

    // Helper to find matching material by name
    const matchMaterial = (extractedName: string) => {
      const clean = extractedName.trim().toLowerCase();
      const matched = availableMaterials.find((m) => {
        const fn = (m.filename || "").toLowerCase();
        const tt = (m.title || "").toLowerCase();
        return fn.includes(clean) || clean.includes(fn) || tt.includes(clean);
      });
      return matched || defaultMaterial;
    };

    const sessionCitations: any[] = Array.isArray(session.citations)
      ? [...session.citations]
      : [];

    // 1. Process Artifacts
    if (Array.isArray(session.artifacts)) {
      for (const artifact of session.artifacts) {
        if (!artifact?.content) continue;

        const bodyText =
          artifact.content.body ||
          artifact.content.explanation ||
          artifact.content.markdown ||
          "";

        const match = bodyText.match(SOURCE_REGEX);
        if (match) {
          const docName = match[1]?.trim() || "Study Guide";
          const pageNum = match[2] ? parseInt(match[2], 10) : undefined;
          const matchedMat = matchMaterial(docName);
          const matId = matchedMat ? String(matchedMat._id) : undefined;
          const matFilename = matchedMat?.filename || docName;

          const cleanBody = bodyText.replace(SOURCE_REGEX, "").trim();

          const newCitation = {
            materialId: matId,
            filename: matFilename,
            pageNumber: pageNum,
            excerpt: cleanBody.slice(0, 150),
          };

          const existingCitations = Array.isArray(artifact.content.citations)
            ? artifact.content.citations
            : [];

          artifact.content.citations = [...existingCitations, newCitation];
          if (artifact.content.body) artifact.content.body = cleanBody;
          if (artifact.content.explanation) artifact.content.explanation = cleanBody;
          if (artifact.content.markdown) artifact.content.markdown = cleanBody;

          // Add to session citations if materialId exists
          if (matId && !sessionCitations.some((c) => c.materialId === matId && c.pageNumber === pageNum)) {
            sessionCitations.push({
              citationId: nanoid(),
              materialId: matId,
              pageNumber: pageNum,
              excerpt: cleanBody.slice(0, 150),
              marker: `[${sessionCitations.length + 1}]`,
              createdAt: new Date(),
            });
          }

          sessionModified = true;
          totalCitationsConverted++;
        }
      }
    }

    // 2. Process Messages
    if (Array.isArray(session.messages)) {
      for (const msg of session.messages) {
        if (!msg?.content || typeof msg.content !== "string") continue;

        const match = msg.content.match(SOURCE_REGEX);
        if (match) {
          msg.content = msg.content.replace(SOURCE_REGEX, "").trim();
          sessionModified = true;
        }
      }
    }

    if (sessionModified) {
      await sessionsCollection.updateOne(
        { _id: session._id },
        {
          $set: {
            artifacts: session.artifacts,
            messages: session.messages,
            citations: sessionCitations,
            updatedAt: new Date(),
          },
        },
      );
      totalSessionsModified++;
    }
  }

  logger.info(
    `Migration 065 complete: checked=${totalSessionsChecked}, modified=${totalSessionsModified}, citationsConverted=${totalCitationsConverted}.`,
  );
}

export async function down(mongoose: Mongoose) {
  logger.info("Rollback 065: No-op. Data migration is backward compatible.");
}
