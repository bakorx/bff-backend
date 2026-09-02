import { z } from "genkit";
import { defineToolOnce, resolveSkillContext } from "../tool-context";
import { ISkill } from "../interfaces";
import { StudySession, CourseSummary as CourseSummaryModel } from "../../models";
import { isValidObjectId, Types } from "mongoose";
import { publishers } from "@/socket";
import { logger } from "@/config";

const generateCourseSummaryTool = defineToolOnce(
  {
    name: "generate_course_summary",
    description:
      "Persist a publication-grade course summary synthesized from the uploaded study materials. Inspects and unifies the logical pillars, topic deep dives, and key takeaways from all session materials into a cohesive editorial document.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      title: z.string().optional().describe("Descriptive course summary title"),
      overview: z
        .string()
        .describe("Comprehensive executive editorial synthesis of the materials"),
      keyTakeaways: z
        .array(z.string())
        .optional()
        .default([])
        .describe("Key high-impact takeaways from across the materials"),
      logicalPillars: z
        .array(
          z.object({
            pillarNumber: z.number().optional().default(1),
            title: z.string(),
            topics: z.array(z.string()).optional().default([]),
          }),
        )
        .optional()
        .default([])
        .describe("The core logical pillars organizing the subject matter from the materials"),
      topicDeepDives: z
        .array(
          z.object({
            title: z.string(),
            description: z.string().optional().default(""),
          }),
        )
        .optional()
        .default([])
        .describe("Deep dive breakdowns into each core topic from the materials"),
    }),
  },
  async (input) => {
    const {
      title,
      overview,
      keyTakeaways = [],
      logicalPillars = [],
      topicDeepDives = [],
    } = input;
    const { sessionId, userId } = await resolveSkillContext(input);

    if (!sessionId || !isValidObjectId(sessionId)) {
      throw new Error("Invalid or missing sessionId");
    }

    const session = await StudySession.findById(sessionId).lean();
    if (!session) throw new Error("Session not found");

    const summaryTitle = title || `Course Summary: ${session.name}`;

    // Check for existing course summary to merge and extend
    const existingSummary = await CourseSummaryModel.findOne({
      sessionId: new Types.ObjectId(sessionId),
    }).lean();

    let mergedLogicalPillars = [...logicalPillars];
    let mergedTopicDeepDives = [...topicDeepDives];
    let mergedKeyTakeaways = [...keyTakeaways];
    let finalOverview = overview;

    if (existingSummary) {
      // Merge logical pillars without duplicates
      const existingPillarTitles = new Set(
        (existingSummary.logicalPillars || []).map((p: any) =>
          p.title.trim().toLowerCase(),
        ),
      );
      const newPillars = logicalPillars.filter(
        (p: any) => !existingPillarTitles.has(p.title.trim().toLowerCase()),
      );
      mergedLogicalPillars = [
        ...(existingSummary.logicalPillars || []),
        ...newPillars,
      ].map((p: any, idx: number) => ({
        ...p,
        pillarNumber: idx + 1,
      }));

      // Merge topic deep dives without duplicates
      const existingDeepDivesNormalized = (
        existingSummary.topicDeepDives || []
      ).map((d: any) => ({
        title: d.title || d.topic || "Deep Dive",
        description: d.description || d.content || "",
      }));
      const existingDeepDiveTitles = new Set(
        existingDeepDivesNormalized.map((d: any) =>
          d.title.trim().toLowerCase(),
        ),
      );
      const newDeepDives = topicDeepDives.filter(
        (d: any) => !existingDeepDiveTitles.has(d.title.trim().toLowerCase()),
      );
      mergedTopicDeepDives = [
        ...existingDeepDivesNormalized,
        ...newDeepDives,
      ];

      // Merge key takeaways without duplicates
      const existingTakeawaysSet = new Set(
        (existingSummary.keyTakeaways || []).map((t: string) =>
          t.trim().toLowerCase(),
        ),
      );
      const newTakeaways = keyTakeaways.filter(
        (t: string) => !existingTakeawaysSet.has(t.trim().toLowerCase()),
      );
      mergedKeyTakeaways = [
        ...(existingSummary.keyTakeaways || []),
        ...newTakeaways,
      ];

      // Keep richer overview
      if (!overview || overview.length < (existingSummary.overview?.length || 0)) {
        finalOverview = existingSummary.overview || overview;
      }
    }

    const sections = [
      {
        title: "Overview",
        body: finalOverview,
      },
      {
        title: "Logical Overview",
        body: mergedLogicalPillars
          .map(
            (p: any) =>
              `**${p.pillarNumber || 1}. ${p.title}:** ${(p.topics || []).join(", ")}`,
          )
          .join("\n\n"),
      },
      ...mergedTopicDeepDives.map((d: any) => ({
        title: d.title || d.topic,
        body: d.description || d.content,
      })),
    ];

    const summaryDoc = await CourseSummaryModel.findOneAndUpdate(
      { sessionId: new Types.ObjectId(sessionId) },
      {
        $set: {
          sessionId: new Types.ObjectId(sessionId),
          userId: new Types.ObjectId(userId || String(session.userId)),
          courseId: session.courseId,
          title: summaryTitle,
          overview: finalOverview,
          logicalPillars: mergedLogicalPillars,
          topicDeepDives: mergedTopicDeepDives,
          keyTakeaways: mergedKeyTakeaways,
          sections,
        },
      },
      { upsert: true, returnDocument: "after" },
    );

    await StudySession.findByIdAndUpdate(sessionId, {
      $set: {
        courseSummary: summaryDoc?._id,
      },
    });

    if (userId) {
      publishers.appSignal(sessionId, userId, {
        type: "course_summary_updated",
        payload: summaryDoc,
        timestamp: new Date(),
      });
    }

    return {
      success: true,
      summaryId: String(summaryDoc._id),
      title: summaryDoc.title,
      overview: summaryDoc.overview,
      totalPillars: mergedLogicalPillars.length,
      totalDeepDives: mergedTopicDeepDives.length,
      isMerged: !!existingSummary,
    };
  },
);

const getCourseSummaryTool = defineToolOnce(
  {
    name: "get_course_summary",
    description:
      "Read or search the course summary in the session.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      search: z.string().optional().describe("Search term matching section title or body"),
    }),
  },
  async (input) => {
    const { sessionId } = await resolveSkillContext(input);
    const { search } = input;

    if (!sessionId || !isValidObjectId(sessionId)) {
      return { success: false, exists: false, reason: "Invalid sessionId" };
    }

    const summary = await CourseSummaryModel.findOne({
      sessionId: new Types.ObjectId(sessionId),
    }).lean();

    if (!summary) {
      return {
        success: false,
        exists: false,
        reason: "No course summary found for this session",
      };
    }

    let sections = summary.sections || [];

    if (search) {
      const searchLower = search.toLowerCase();
      sections = sections.filter(
        (s) =>
          s.title.toLowerCase().includes(searchLower) ||
          s.body.toLowerCase().includes(searchLower),
      );
    }

    return {
      success: true,
      exists: true,
      title: summary.title,
      overview: summary.overview,
      logicalPillars: summary.logicalPillars,
      topicDeepDives: summary.topicDeepDives,
      sections,
      totalSections: sections.length,
    };
  },
);

const courseSummarySkill: ISkill = {
  name: "course_summary",
  displayName: "Course Summary",
  description:
    "Generate, structure, and inspect course-wide editorial summaries with Logical Overview pillars and Topic Deep Dives.",
  scope: "session",
  category: "analysis",
  tools: [generateCourseSummaryTool, getCourseSummaryTool],
  phases: ["analysis", "planning", "implementation", "verification", "signoff"],
  autoEquip: (s) => s.mode === "structured",
};

export default courseSummarySkill;
