import { z } from "genkit";
import { ai } from "@/ai/config";
import { defineToolOnce, resolveSkillContext } from "../tool-context";
import { ISkill } from "../interfaces";
import { selectors as learningSelectors } from "@/learning";
import { MemoryServices } from "../../memory/services";

const MAX_PROMPT_TEXT_LENGTH = 8000;

const ANALYZE_MATERIAL_PROMPT = (text: string) =>
  `Analyze the following academic material and identify:\n- Learning objectives\n- Prerequisites students need\n- Difficult concepts\n- Estimated study time in minutes\n\nMaterial:\n${text.slice(0, MAX_PROMPT_TEXT_LENGTH)}`;

const analyzeMaterialTool = defineToolOnce(
  {
    name: "analyze_material",
    description:
      "Analyze an uploaded study material to extract learning objectives, prerequisites, and difficult concepts.",
    inputSchema: z.object({
      materialId: z.string(),
      sessionId: z.string().optional(),
    }),
  },
  async (input) => {
    const { materialId } = input;
    const { sessionId } = await resolveSkillContext(input);
    let material;
    if (sessionId) {
      const materials =
        await learningSelectors.getMaterialsBySession(sessionId);
      material = materials.find(
        (m) => String((m as { _id: unknown })._id) === materialId,
      );
    } else {
      material = await learningSelectors.getMaterialById(materialId);
    }
    if (!material) throw new Error("Material not found");
    const extractedText =
      (material as { extractedText?: string }).extractedText ?? "";
    const { output } = await ai.generate({
      prompt: ANALYZE_MATERIAL_PROMPT(extractedText),
      output: {
        schema: z.object({
          objectives: z.array(z.string()),
          prerequisites: z.array(z.string()),
          difficultConcepts: z.array(z.string()),
          estimatedStudyMins: z.number(),
        }),
      },
    });
    if (!output) throw new Error("No output from material analysis");
    return output;
  },
);

const identifyGapsTool = defineToolOnce(
  {
    name: "identify_gaps",
    description:
      "Cross-reference identified concepts with student memory to find knowledge gaps.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      courseId: z.string().optional(),
      identifiedConcepts: z.array(z.string()),
    }),
  },
  async (input) => {
    const { identifiedConcepts } = input;
    const { userId, courseId } = await resolveSkillContext(input);

    if (!userId) {
      throw new Error("userId or sessionId is required to identify gaps");
    }
    const memory = await MemoryServices.snapshot(userId, courseId);
    const knownConcepts = memory?.knownConcepts ?? [];
    return {
      gaps: identifiedConcepts.filter((c) => !knownConcepts.includes(c)),
    };
  },
);

const getCourseContextTool = defineToolOnce(
  {
    name: "get_course_context",
    description: "Get basic course information for context.",
    inputSchema: z.object({ courseId: z.string() }),
  },
  async ({ courseId }) => {
    const { default: mongoose } = await import("mongoose");
    const Course = mongoose.models["Course"] as
      | import("mongoose").Model<{
          title: string;
          code: string;
          yearLevel?: number;
        }>
      | undefined;
    if (!Course) return { title: "Unknown Course", code: courseId };
    const course = await Course.findById(courseId).lean();
    if (!course) return { title: "Unknown Course", code: courseId };
    return {
      title: course.title,
      code: course.code,
      yearLevel: course.yearLevel,
    };
  },
);

const searchMaterialsTool = defineToolOnce(
  {
    name: "search_materials",
    description:
      "Search available course materials by filename, material type, or content keywords with pagination and search filters.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      courseId: z.string().optional(),
      search: z
        .string()
        .optional()
        .describe("Search keywords matching filename or material description"),
      materialType: z
        .enum([
          "syllabus",
          "test_examples",
          "course_context",
          "learning_material",
        ])
        .optional(),
      page: z.number().optional(),
      limit: z.number().optional(),
      sortBy: z.string().optional(),
      sortOrder: z.enum(["asc", "desc"]).optional(),
    }),
  },
  async (input) => {
    const { sessionId } = await resolveSkillContext(input);
    const {
      courseId,
      search,
      materialType,
      page = 1,
      limit = 10,
      sortBy = "uploadedAt",
      sortOrder = "desc",
    } = input;

    let materials: any[] = [];
    if (sessionId) {
      materials = await learningSelectors.getMaterialsBySession(sessionId, {
        search,
        page,
        limit,
        sortBy,
        sortOrder,
        ...(materialType ? { materialType } : {}),
      });
    } else if (courseId) {
      materials = await learningSelectors.getMaterialsByCourse(courseId, {
        search,
        page,
        limit,
        sortBy,
        sortOrder,
        ...(materialType ? { materialType } : {}),
      });
    }

    return {
      success: true,
      total: materials.length,
      page,
      limit,
      materials: materials.map((m: any) => ({
        materialId: String(m._id),
        filename: m.filename,
        materialType: m.materialType,
        uploadedAt: m.uploadedAt,
      })),
    };
  },
);

const syllabusResearchSkill: ISkill = {
  name: "syllabus_research",
  displayName: "Syllabus Research",
  description:
    "Analyze materials, search content, identify knowledge gaps, and gather course context during analysis phase.",
  scope: "session",
  category: "analysis",
  tools: [
    analyzeMaterialTool,
    identifyGapsTool,
    getCourseContextTool,
    searchMaterialsTool,
  ],
  phases: ["analysis"],
  autoEquip: (s) => s.mode === "structured" && !!s.courseId,
};

export default syllabusResearchSkill;
