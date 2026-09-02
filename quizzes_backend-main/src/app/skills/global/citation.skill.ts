import { z } from "genkit";
import { ISkill } from "../interfaces";
import { services as materialServices } from "@/learning";
import { defineToolOnce, resolveSkillContext } from "../tool-context";
import { emit as emitEvent } from "@/events/services";

const searchMaterialsTool = defineToolOnce(
  {
    name: "search_materials",
    description:
      "Search uploaded study materials for relevant content using semantic search.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      courseId: z.string().optional(),
      query: z.string(),
      limit: z.number().min(1).max(25).default(10),
      materialIds: z.array(z.string()).optional(),
    }),
  },
  async (input) => {
    const { query, limit } = input;
    const { sessionId, courseId, materialIds } =
      await resolveSkillContext(input);
    return materialServices.search(sessionId, query, limit, {
      courseId,
      materialIds: input.materialIds || materialIds,
    });
  },
);

const citeSourceTool = defineToolOnce(
  {
    name: "cite_source",
    description: "Save a citation from a study material to the session/chat.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      messageId: z.string(),
      materialId: z.string(),
      excerpt: z.string(),
      pageNumber: z.number().nullable().optional(),
    }),
  },
  async (input) => {
    const { messageId, materialId, excerpt, pageNumber } = input;
    const { sessionId, userId } = await resolveSkillContext(input);
    const citation = await materialServices.saveCitation(
      sessionId,
      messageId,
      materialId,
      excerpt,
      pageNumber ?? undefined,
    );

    if (sessionId && userId) {
      emitEvent(
        "session:citation_added",
        userId,
        { type: "session", id: sessionId },
        { materialId, messageId },
      );
    }

    return citation;
  },
);

const citationSkill: ISkill = {
  name: "citation",
  displayName: "Citation",
  description: "Search materials and cite sources in responses.",
  scope: "global",
  category: "utility",
  tools: [searchMaterialsTool, citeSourceTool],
  phases: [],
};

export default citationSkill;
