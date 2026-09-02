import { z } from "genkit";
import { nanoid } from "nanoid";
import { defineToolOnce, resolveSkillContext } from "../tool-context";
import { ISkill } from "../interfaces";
import { StudySession } from "../../models";
import { Material, services as materialServices } from "@/learning";
import { runInTransaction } from "@/utils";
import { isValidObjectId } from "mongoose";
import { publishers } from "@/socket";

const createExpositionTool = defineToolOnce(
  {
    name: "create_exposition",
    description:
      "Create a focused concept deep dive (Exposition) card for a specific knowledge block, citing the source material and page number.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      blockId: z.string(),
      topicTitle: z.string(),
      explanation: z.string().describe("Clear, engaging exposition of the concept"),
      materialId: z.string().optional(),
      pageNumber: z.number().optional(),
      audioScript: z.string().optional().describe("Clean prose for text-to-speech audio reading"),
    }),
  },
  async (input) => {
    const { blockId, topicTitle, explanation, pageNumber, audioScript } = input;
    const { sessionId, userId } = await resolveSkillContext(input);

    if (!sessionId || !isValidObjectId(sessionId)) {
      throw new Error("Invalid or missing sessionId");
    }

    const session = await StudySession.findById(sessionId).lean();
    if (!session) throw new Error("Session not found");

    let materialId = input.materialId;
    let filename = "Source Document";

    if (!materialId && session.materialIds && session.materialIds.length > 0) {
      materialId = String(session.materialIds[0]);
    }

    if (materialId && isValidObjectId(materialId)) {
      const mat = await Material.findById(materialId).select("filename").lean();
      if (mat) filename = mat.filename;
    }

    const messageId = nanoid();
    const artifactId = nanoid();

    // Clean any accidental markdown text citation appended by the model
    const cleanExplanation = (explanation || "")
      .replace(/\s*\((?:Source|Ref):\s*[^)]+\)\s*$/i, "")
      .trim();

    const structuredCitations = materialId
      ? [
          {
            materialId,
            filename,
            pageNumber,
            excerpt: cleanExplanation.slice(0, 150),
          },
        ]
      : [];

    const lessonContent = {
      topicTitle,
      body: cleanExplanation,
      keyPoints: [topicTitle],
      examples: [],
      analogy: undefined,
      citations: structuredCitations,
    };

    let citationMarker: string | undefined;
    if (materialId) {
      const citationRes = await materialServices.saveCitation(
        sessionId,
        messageId,
        materialId,
        cleanExplanation.slice(0, 150),
        pageNumber,
      );
      citationMarker = citationRes.marker;
    }

    const fullArtifact = {
      artifactId,
      type: "lesson" as const,
      title: topicTitle,
      content: lessonContent,
      phase: session.currentPhase || "implementation",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await runInTransaction(async (txSession) => {
      await StudySession.findByIdAndUpdate(
        sessionId,
        {
          $push: {
            artifacts: fullArtifact,
            messages: {
              messageId,
              role: "z",
              type: "artifact",
              content: cleanExplanation,
              artifactId,
              artifact: fullArtifact,
              phase: session.currentPhase || "implementation",
              timestamp: new Date(),
            },
          },
          $set: {
            activeBlockId: blockId,
          },
        },
        { session: txSession },
      );
    });

    if (userId) {
      publishers.appArtifact(
        sessionId,
        userId,
        artifactId,
        "lesson",
        topicTitle,
      );
    }

    return {
      success: true,
      artifactId,
      messageId,
      topicTitle,
      filename,
      pageNumber,
      citationMarker,
    };
  },
);

const getExpositionTool = defineToolOnce(
  {
    name: "get_exposition",
    description:
      "Read or search existing concept exposition / lesson artifacts in the session using search filters, keywords, and pagination.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      artifactId: z.string().optional(),
      search: z.string().optional().describe("Search term for topic title or explanation content"),
      topicTitle: z.string().optional(),
      page: z.number().optional(),
      limit: z.number().optional(),
      sortBy: z.string().optional(),
      sortOrder: z.enum(["asc", "desc"]).optional(),
    }),
  },
  async (input) => {
    const { sessionId } = await resolveSkillContext(input);
    if (!sessionId || !isValidObjectId(sessionId)) {
      throw new Error("Invalid or missing sessionId");
    }
    const session = await StudySession.findById(sessionId).lean();
    if (!session) throw new Error("Session not found");

    let lessonArtifacts = (session.artifacts || []).filter((a) => a.type === "lesson");

    if (input.artifactId) {
      lessonArtifacts = lessonArtifacts.filter((a) => a.artifactId === input.artifactId);
    }

    if (input.topicTitle) {
      const topicLower = input.topicTitle.toLowerCase();
      lessonArtifacts = lessonArtifacts.filter(
        (a) => a.title.toLowerCase().includes(topicLower) ||
          String((a.content as any)?.topicTitle || "").toLowerCase().includes(topicLower),
      );
    }

    if (input.search) {
      const searchLower = input.search.toLowerCase();
      lessonArtifacts = lessonArtifacts.filter(
        (a) =>
          a.title.toLowerCase().includes(searchLower) ||
          JSON.stringify(a.content || {}).toLowerCase().includes(searchLower),
      );
    }

    // Sorting
    const sortOrder = input.sortOrder === "asc" ? 1 : -1;
    lessonArtifacts.sort((a, b) => {
      const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
      const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
      return (aTime - bTime) * sortOrder;
    });

    const total = lessonArtifacts.length;
    const page = input.page || 1;
    const limit = input.limit || 10;
    const startIndex = (page - 1) * limit;
    const paginatedArtifacts = lessonArtifacts.slice(startIndex, startIndex + limit);

    if (paginatedArtifacts.length === 0) {
      return { success: false, exists: false, total: 0, reason: "No matching exposition artifacts found" };
    }

    const primary = paginatedArtifacts[0];
    return {
      success: true,
      exists: true,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      artifactId: primary.artifactId,
      title: primary.title,
      content: primary.content,
      results: paginatedArtifacts.map((art) => ({
        artifactId: art.artifactId,
        title: art.title,
        content: art.content,
        createdAt: art.createdAt,
      })),
    };
  },
);

const updateExpositionTool = defineToolOnce(
  {
    name: "update_exposition",
    description: "Update the title, explanation text, or citation notes in an existing exposition artifact.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      artifactId: z.string(),
      title: z.string().optional(),
      explanation: z.string().optional(),
    }),
  },
  async (input) => {
    const { sessionId, userId } = await resolveSkillContext(input);
    const { artifactId, title, explanation } = input;

    if (!sessionId || !isValidObjectId(sessionId)) {
      throw new Error("Invalid or missing sessionId");
    }

    const session = await StudySession.findById(sessionId).lean();
    if (!session) throw new Error("Session not found");

    const artifact = (session.artifacts || []).find((a) => a.artifactId === artifactId);
    if (!artifact) throw new Error("Exposition artifact not found");

    const content: any = artifact.content || {};
    if (explanation) {
      content.explanation = explanation;
      if (Array.isArray(content.sections) && content.sections.length > 0) {
        content.sections[0].body = explanation;
      }
    }

    await runInTransaction(async (txSession) => {
      await StudySession.findByIdAndUpdate(
        sessionId,
        {
          $set: {
            "artifacts.$[art].content": content,
            "artifacts.$[art].title": title || artifact.title,
            "artifacts.$[art].updatedAt": new Date(),
          },
        },
        {
          arrayFilters: [{ "art.artifactId": artifactId }],
          session: txSession,
        },
      );
    });

    if (userId) {
      publishers.appArtifactUpdated(sessionId, userId, {
        artifactId,
        type: "lesson",
        title: title || artifact.title,
        content,
      });
    }

    return { success: true, artifactId, updated: true };
  },
);

const createRecapTool = defineToolOnce(
  {
    name: "create_recap",
    description:
      "Persist a concept or topic recap summary artifact card with key takeaway points.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      topicTitle: z.string().describe("Title of the topic or concept being summarized"),
      content: z.string().optional().describe("Concise takeaway summary narrative"),
      keyPoints: z.array(z.string()).describe("List of core key points or takeaways"),
    }),
  },
  async (input) => {
    const { topicTitle, content, keyPoints } = input;
    const { sessionId, userId } = await resolveSkillContext(input);

    if (!sessionId || !isValidObjectId(sessionId)) {
      throw new Error("Invalid or missing sessionId");
    }

    const session = await StudySession.findById(sessionId).lean();
    if (!session) throw new Error("Session not found");

    const messageId = nanoid();
    const artifactId = nanoid();

    const recapContent = {
      topicTitle,
      content,
      keyPoints,
    };

    const fullArtifact = {
      artifactId,
      type: "summary" as const,
      title: topicTitle,
      content: recapContent,
      phase: session.currentPhase || "implementation",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await runInTransaction(async (txSession) => {
      await StudySession.findByIdAndUpdate(
        sessionId,
        {
          $push: {
            artifacts: fullArtifact,
            messages: {
              messageId,
              role: "z",
              type: "artifact",
              content: content || topicTitle,
              artifactId,
              artifact: fullArtifact,
              phase: session.currentPhase || "implementation",
              timestamp: new Date(),
            },
          },
        },
        { session: txSession },
      );
    });

    if (userId) {
      publishers.appArtifact(
        sessionId,
        userId,
        artifactId,
        "summary",
        topicTitle,
      );
    }

    return {
      success: true,
      artifactId,
      messageId,
      topicTitle,
      keyPoints,
    };
  },
);

const expositionSkill: ISkill = {
  name: "exposition",
  displayName: "Exposition & Recap",
  description:
    "Generate, read, and update structured concept deep dives with citations, and persist topic recap summaries.",
  scope: "session",
  category: "implementation",
  tools: [getExpositionTool, createExpositionTool, updateExpositionTool, createRecapTool],
  phases: ["implementation", "analysis"],
};

export default expositionSkill;
