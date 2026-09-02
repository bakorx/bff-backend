import { z } from "genkit";
import { nanoid } from "nanoid";
import { defineToolOnce, resolveSkillContext } from "../tool-context";
import { ISkill } from "../interfaces";
import { StudySession, StudyPlan as StudyPlanModel } from "../../models";
import { StudyPlan, IStudyChapter, IStudyStep, IKnowledgeBlock } from "../../interfaces";
import { runInTransaction } from "@/utils";
import { isValidObjectId, Types } from "mongoose";
import { publishers } from "@/socket";
import { logger } from "@/config";

const generateStudyPlanTool = defineToolOnce(
  {
    name: "generate_study_plan",
    description:
      "Persist a comprehensive, structured study plan synthesized by inspecting, connecting, and linking knowledge blocks and logical pillars extracted from the uploaded study materials. Chapters organize concepts into a sequential roadmap, containing study steps (topics) with core ideas, why it matters, and prerequisite knowledge blocks.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      goal: z.string().describe("Overall learning objective or course goal"),
      estimatedMinutes: z
        .number()
        .optional()
        .describe("Estimated total study time in minutes"),
      chapters: z
        .array(
          z.object({
            number: z.number().optional(),
            title: z.string().describe("The descriptive title of the chapter"),
            description: z
              .string()
              .optional()
              .describe("Summary of what is covered in this chapter"),
            isRecommended: z.boolean().optional(),
            steps: z
              .array(
                z.object({
                  order: z.number().optional(),
                  title: z.string().describe("Topic title"),
                  description: z.string().optional(),
                  coreIdea: z
                    .string()
                    .optional()
                    .default("")
                    .describe("Core intuition / principle behind the topic"),
                  whyItMatters: z
                    .string()
                    .optional()
                    .default("")
                    .describe("Practical importance and real-world relevance"),
                  prerequisites: z
                    .array(
                      z.object({
                        title: z
                          .string()
                          .describe("Knowledge block concept or title"),
                        summary: z
                          .string()
                          .optional()
                          .describe("Explanation or context for this knowledge block"),
                      }),
                    )
                    .optional()
                    .default([])
                    .describe(
                      "Foundational knowledge blocks to learn/master in this topic step, directly connecting concepts and knowledge blocks from the uploaded materials",
                    ),
                }),
              )
              .optional()
              .default([])
              .describe("Sequential study steps (topics) for this chapter"),
          }),
        )
        .describe("The structured roadmap chapters connecting source material concepts"),
    }),
  },
  async (input) => {
    const { goal, estimatedMinutes, chapters: inputChapters = [] } = input;
    const { sessionId, userId, materialIds } = await resolveSkillContext(input);

    if (!sessionId || !isValidObjectId(sessionId)) {
      throw new Error("Invalid or missing sessionId");
    }

    const session = await StudySession.findById(sessionId).lean();
    if (!session) throw new Error("Session not found");

    const defaultMatId =
      materialIds && materialIds.length > 0 ? String(materialIds[0]) : undefined;

    // Check for existing study plan to preserve progress and extend chapters
    const existingPlanDoc = await StudyPlanModel.findOne({
      sessionId: new Types.ObjectId(sessionId),
    }).lean();

    // Map of completed knowledge blocks by title/concept or blockId
    const completedBlockMap = new Map<string, { completedAt?: Date }>();
    const existingChapterMap = new Map<string, IStudyChapter>();

    if (existingPlanDoc && Array.isArray(existingPlanDoc.chapters)) {
      for (const ch of existingPlanDoc.chapters) {
        existingChapterMap.set(ch.title.trim().toLowerCase(), ch as IStudyChapter);
        for (const st of ch.steps || []) {
          for (const blk of st.prerequisites || []) {
            if (blk.completed) {
              completedBlockMap.set(blk.title.trim().toLowerCase(), {
                completedAt: blk.completedAt,
              });
              if (blk.blockId) {
                completedBlockMap.set(blk.blockId, {
                  completedAt: blk.completedAt,
                });
              }
            }
          }
        }
      }
    }

    let totalAllBlocks = 0;
    let totalAllCompleted = 0;
    const processedChapters: IStudyChapter[] = [];

    inputChapters.forEach((ch, cIdx) => {
      const existingCh = existingChapterMap.get(ch.title.trim().toLowerCase());
      const chId = existingCh?.chapterId || nanoid();
      const chapterGoals: any[] = [];
      const chapterSteps: IStudyStep[] = [];
      let chapterTotalBlocks = 0;
      let chapterCompletedBlocks = 0;

      const rawSteps = ch.steps || [];
      rawSteps.forEach((st: any, sIdx: number) => {
        // Prerequisites ARE the knowledge blocks for this topic
        const rawPrereqs = st.prerequisites || [];
        const stepPrereqs: IKnowledgeBlock[] = rawPrereqs.map(
          (p: any, pIdx: number) => {
            const pTitle =
              typeof p === "string"
                ? p
                : p.title || p.concept || "Knowledge Block";
            const isCompletedRecord =
              completedBlockMap.get(pTitle.trim().toLowerCase()) ||
              (typeof p === "object" && p.blockId
                ? completedBlockMap.get(p.blockId)
                : undefined);

            const isDone = !!isCompletedRecord || (typeof p === "object" && !!p.completed);

            return {
              blockId:
                typeof p === "object" && p.blockId
                  ? p.blockId
                  : `kb-${cIdx + 1}-${sIdx + 1}-${pIdx + 1}-${nanoid(4)}`,
              title: pTitle,
              summary: typeof p === "string" ? p : p.summary || "",
              materialId: defaultMatId,
              completed: isDone,
              completedAt: isDone
                ? isCompletedRecord?.completedAt || new Date()
                : undefined,
              order: pIdx + 1,
            };
          },
        );

        const stepCompletedCount = stepPrereqs.filter((b) => b.completed).length;
        totalAllBlocks += stepPrereqs.length;
        totalAllCompleted += stepCompletedCount;
        chapterTotalBlocks += stepPrereqs.length;
        chapterCompletedBlocks += stepCompletedCount;

        const isStepComplete =
          stepPrereqs.length > 0 && stepCompletedCount === stepPrereqs.length;

        const stepGoal = {
          goalId: nanoid(),
          title: `Master ${st.title}`,
          status: (isStepComplete ? "completed" : "pending") as "completed" | "pending",
          targetBlockIds: stepPrereqs.map((b) => b.blockId),
          completedAt: isStepComplete ? new Date() : undefined,
        };
        chapterGoals.push(stepGoal);

        chapterSteps.push({
          stepId: nanoid(),
          topicId: nanoid(),
          label: `Topic ${sIdx + 1}`,
          order: st.order || sIdx + 1,
          title: st.title,
          description: st.description || "",
          coreIdea: st.coreIdea || "",
          whyItMatters: st.whyItMatters || "",
          prerequisites: stepPrereqs,
          goals: [stepGoal],
          completedBlocks: stepCompletedCount,
          totalBlocks: stepPrereqs.length,
          isCompleted: isStepComplete,
        });
      });

      processedChapters.push({
        chapterId: chId,
        number: ch.number || cIdx + 1,
        title: ch.title,
        description: ch.description || "",
        isRecommended:
          ch.isRecommended !== undefined
            ? ch.isRecommended
            : existingCh?.isRecommended !== undefined
              ? existingCh.isRecommended
              : cIdx === 0,
        goals: chapterGoals,
        steps: chapterSteps,
        completedBlocks: chapterCompletedBlocks,
        totalBlocks: chapterTotalBlocks,
      });
    });

    const plan: StudyPlan = {
      goal: goal || existingPlanDoc?.goal || session.name || "Master course materials",
      courseId: session.courseId ? String(session.courseId) : undefined,
      chapters: processedChapters,
      totalChapters: processedChapters.length,
      totalBlocks: totalAllBlocks,
      completedBlocks: totalAllCompleted,
      estimatedMinutes:
        estimatedMinutes ||
        existingPlanDoc?.estimatedMinutes ||
        Math.max(totalAllBlocks * 15, 30),
      editedByUser: existingPlanDoc?.editedByUser || false,
    };

    const studyPlanDoc = await StudyPlanModel.findOneAndUpdate(
      { sessionId: new Types.ObjectId(sessionId) },
      {
        $set: {
          sessionId: new Types.ObjectId(sessionId),
          userId: new Types.ObjectId(userId || String(session.userId)),
          courseId: session.courseId,
          goal: plan.goal,
          chapters: plan.chapters,
          totalChapters: plan.totalChapters,
          totalBlocks: plan.totalBlocks,
          completedBlocks: plan.completedBlocks,
          estimatedMinutes: plan.estimatedMinutes,
          editedByUser: plan.editedByUser,
        },
      },
      { upsert: true, returnDocument: "after" },
    );

    await StudySession.findByIdAndUpdate(sessionId, {
      $set: {
        studyPlan: studyPlanDoc?._id,
        totalBlocks: totalAllBlocks,
        completedBlocks: totalAllCompleted,
        activeChapterId: processedChapters[0]?.chapterId,
        activeStepId: processedChapters[0]?.steps?.[0]?.stepId,
        activeBlockId:
          processedChapters[0]?.steps?.[0]?.prerequisites?.[0]?.blockId,
      },
    });

    if (userId) {
      publishers.appStudyPlanUpdated(sessionId, userId, plan);
    }

    return {
      success: true,
      studyPlanId: String(studyPlanDoc?._id),
      totalChapters: plan.totalChapters,
      totalBlocks: plan.totalBlocks,
      completedBlocks: plan.completedBlocks,
      goal: plan.goal,
      isMerged: !!existingPlanDoc,
    };
  },
);

const completeKnowledgeBlockTool = defineToolOnce(
  {
    name: "complete_knowledge_block",
    description:
      "Mark a specific knowledge block as completed and update progress across chapter and session.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      blockId: z.string(),
    }),
  },
  async (input) => {
    const { blockId } = input;
    const { sessionId, userId } = await resolveSkillContext(input);

    if (!sessionId || !isValidObjectId(sessionId)) {
      throw new Error("Invalid or missing sessionId");
    }

    const session = await StudySession.findById(sessionId).lean();
    if (!session) throw new Error("Session not found");

    let planDoc = await StudyPlanModel.findOne({
      sessionId: new Types.ObjectId(sessionId),
    }).lean();

    if (!planDoc) throw new Error("Study plan not found");

    const plan = JSON.parse(JSON.stringify(planDoc)) as StudyPlan;
    let targetChapter: IStudyChapter | undefined;
    let targetStep: IStudyStep | undefined;
    let targetBlock: IKnowledgeBlock | undefined;

    for (const chapter of plan.chapters || []) {
      for (const step of chapter.steps || []) {
        for (const block of step.prerequisites || []) {
          if (block.blockId === blockId) {
            block.completed = true;
            block.completedAt = new Date();
            targetChapter = chapter;
            targetStep = step;
            targetBlock = block;
          }
        }
      }
    }

    if (!targetBlock) {
      return { success: false, reason: "Block not found in study plan" };
    }

    // Recompute counts
    let sessionTotal = 0;
    let sessionCompleted = 0;
    const completedBlockIds: string[] = [];

    (plan.chapters || []).forEach((ch) => {
      let chCompleted = 0;
      let chTotal = 0;
      (ch.steps || []).forEach((st) => {
        const stCompleted = (st.prerequisites || []).filter(
          (b: IKnowledgeBlock) => b.completed,
        ).length;
        const stTotal = (st.prerequisites || []).length;
        st.completedBlocks = stCompleted;
        st.totalBlocks = stTotal;
        chCompleted += stCompleted;
        chTotal += stTotal;
        (st.prerequisites || []).forEach((b: IKnowledgeBlock) => {
          if (b.completed) completedBlockIds.push(b.blockId);
        });
      });
      ch.completedBlocks = chCompleted;
      ch.totalBlocks = chTotal;
      sessionCompleted += chCompleted;
      sessionTotal += chTotal;

      // Update chapter goals status
      (ch.goals || []).forEach((g) => {
        if (chCompleted >= chTotal && chTotal > 0) {
          g.status = "completed";
          g.completedAt = new Date();
        }
      });
    });

    plan.totalBlocks = sessionTotal;
    plan.completedBlocks = sessionCompleted;

    const studyPlanDoc = await StudyPlanModel.findOneAndUpdate(
      { sessionId: new Types.ObjectId(sessionId) },
      {
        $set: {
          chapters: plan.chapters,
          totalChapters: (plan.chapters || []).length,
          totalBlocks: sessionTotal,
          completedBlocks: sessionCompleted,
          editedByUser: plan.editedByUser,
        },
      },
      { upsert: true, returnDocument: "after" },
    );

    await StudySession.findByIdAndUpdate(sessionId, {
      $set: {
        studyPlan: studyPlanDoc?._id,
        totalBlocks: sessionTotal,
        completedBlocks: sessionCompleted,
        completedBlockIds,
      },
    });

    if (userId) {
      publishers.appBlockCompleted(sessionId, userId, {
        blockId,
        completed: true,
        chapterId: targetChapter?.chapterId || "",
        chapterProgress: {
          completed: targetChapter?.completedBlocks || 0,
          total: targetChapter?.totalBlocks || 0,
        },
        sessionProgress: {
          completed: sessionCompleted,
          total: sessionTotal,
        },
      });
    }

    return {
      success: true,
      blockId,
      completed: true,
      chapterCompleted: targetChapter?.completedBlocks,
      chapterTotal: targetChapter?.totalBlocks,
    };
  },
);

const updateStudyPlanTool = defineToolOnce(
  {
    name: "update_study_plan",
    description:
      "Update, modify, or add chapters, goals, or knowledge blocks in the active study plan.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      goal: z.string().optional().describe("Updated overall goal for the study plan"),
      chapters: z
        .array(
          z.object({
            chapterId: z.string().optional(),
            number: z.number().optional(),
            title: z.string(),
            description: z.string().optional(),
            isRecommended: z.boolean().optional(),
            goals: z
              .array(
                z.object({
                  goalId: z.string().optional(),
                  title: z.string(),
                  description: z.string().optional(),
                  status: z
                    .enum(["pending", "active", "completed", "skipped"])
                    .optional(),
                }),
              )
              .optional(),
            steps: z
              .array(
                z.object({
                  stepId: z.string().optional(),
                  label: z.string().optional(),
                  order: z.number().optional(),
                  title: z.string(),
                  description: z.string().optional(),
                  coreIdea: z.string().optional(),
                  whyItMatters: z.string().optional(),
                  prerequisites: z
                    .array(
                      z.object({
                        blockId: z.string().optional(),
                        title: z.string(),
                        summary: z.string().optional(),
                        completed: z.boolean().optional(),
                        order: z.number().optional(),
                      }),
                    )
                    .optional(),
                }),
              )
              .optional(),
          }),
        )
        .optional(),
    }),
  },
  async (input) => {
    const { sessionId, userId } = await resolveSkillContext(input);

    if (!sessionId || !isValidObjectId(sessionId)) {
      throw new Error("Invalid or missing sessionId");
    }

    const session = await StudySession.findById(sessionId).lean();
    if (!session) throw new Error("Session not found");

    let planDoc = await StudyPlanModel.findOne({
      sessionId: new Types.ObjectId(sessionId),
    }).lean();

    const plan: StudyPlan = planDoc
      ? (JSON.parse(JSON.stringify(planDoc)) as StudyPlan)
      : {
          goal: input.goal || session.name || "Master course materials",
          chapters: [],
          totalChapters: 0,
          totalBlocks: 0,
          completedBlocks: 0,
          estimatedMinutes: 60,
          editedByUser: true,
        };

    if (input.goal) {
      plan.goal = input.goal;
    }

    if (input.chapters && Array.isArray(input.chapters)) {
      plan.chapters = input.chapters.map((ch, chIdx) => ({
        chapterId: ch.chapterId || nanoid(),
        number: ch.number || chIdx + 1,
        title: ch.title,
        description: ch.description || "",
        isRecommended: ch.isRecommended || false,
        goals: (ch.goals || []).map((g) => ({
          goalId: g.goalId || nanoid(),
          title: g.title,
          description: g.description,
          status: g.status || "pending",
        })),
        steps: (ch.steps || []).map((st, stIdx) => ({
          stepId: st.stepId || nanoid(),
          label: st.label || `Step ${stIdx + 1}`,
          order: st.order || stIdx + 1,
          title: st.title || `Topic ${stIdx + 1}`,
          description: st.description || "",
          coreIdea: st.coreIdea || "",
          whyItMatters: st.whyItMatters || "",
          prerequisites: (st.prerequisites || []).map((b, bIdx) => ({
            blockId: b.blockId || nanoid(),
            title: b.title,
            summary: b.summary,
            completed: !!b.completed,
            order: b.order || bIdx + 1,
          })),
          completedBlocks: (st.prerequisites || []).filter((b) => b.completed).length,
          totalBlocks: (st.prerequisites || []).length,
        })),
        completedBlocks: 0,
        totalBlocks: 0,
      }));
    }

    // Recompute counts
    let sessionTotal = 0;
    let sessionCompleted = 0;
    const completedBlockIds: string[] = [];

    (plan.chapters || []).forEach((ch) => {
      let chCompleted = 0;
      let chTotal = 0;
      (ch.steps || []).forEach((st) => {
        const stCompleted = (st.prerequisites || []).filter(
          (b: IKnowledgeBlock) => b.completed,
        ).length;
        const stTotal = (st.prerequisites || []).length;
        st.completedBlocks = stCompleted;
        st.totalBlocks = stTotal;
        chCompleted += stCompleted;
        chTotal += stTotal;
        (st.prerequisites || []).forEach((b: IKnowledgeBlock) => {
          if (b.completed) completedBlockIds.push(b.blockId);
        });
      });
      ch.completedBlocks = chCompleted;
      ch.totalBlocks = chTotal;
      sessionCompleted += chCompleted;
      sessionTotal += chTotal;
    });

    plan.totalChapters = (plan.chapters || []).length;
    plan.totalBlocks = sessionTotal;
    plan.completedBlocks = sessionCompleted;
    plan.editedByUser = true;

    const studyPlanDoc = await StudyPlanModel.findOneAndUpdate(
      { sessionId: new Types.ObjectId(sessionId) },
      {
        $set: {
          sessionId: new Types.ObjectId(sessionId),
          userId: new Types.ObjectId(userId || String(session.userId)),
          courseId: session.courseId,
          goal: plan.goal,
          chapters: plan.chapters,
          totalChapters: plan.totalChapters,
          totalBlocks: sessionTotal,
          completedBlocks: sessionCompleted,
          editedByUser: true,
        },
      },
      { upsert: true, returnDocument: "after" },
    );

    await StudySession.findByIdAndUpdate(sessionId, {
      $set: {
        studyPlan: studyPlanDoc?._id,
        totalBlocks: sessionTotal,
        completedBlocks: sessionCompleted,
        completedBlockIds,
      },
    });

    if (userId) {
      publishers.appStudyPlanUpdated(sessionId, userId, plan);
    }

    return {
      success: true,
      plan,
      totalChapters: plan.totalChapters,
      totalBlocks: sessionTotal,
      completedBlocks: sessionCompleted,
    };
  },
);

const getStudyPlanTool = defineToolOnce(
  {
    name: "get_study_plan",
    description:
      "Read or search the active study plan for the session, with optional search keywords, chapter filtering, and status filters.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      search: z.string().optional().describe("Search term matching chapter titles, goals, or knowledge block concepts"),
      chapterNumber: z.number().optional().describe("Filter for a specific chapter number"),
      goalStatus: z.enum(["pending", "active", "completed", "skipped"]).optional(),
      page: z.number().optional(),
      limit: z.number().optional(),
    }),
  },
  async (input) => {
    const { sessionId } = await resolveSkillContext(input);
    if (!sessionId || !isValidObjectId(sessionId)) {
      throw new Error("Invalid or missing sessionId");
    }
    const session = await StudySession.findById(sessionId).lean();
    if (!session) throw new Error("Session not found");

    const planArtifact = [...(session.artifacts || [])]
      .filter((a) => a.type === "study_plan")
      .sort((a, b) => {
        const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
        const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
        return bTime - aTime;
      })[0];

    if (!planArtifact) {
      return { success: false, exists: false, reason: "No study plan found" };
    }

    const plan = planArtifact.content as StudyPlan;
    let filteredChapters = [...(plan.chapters || [])];

    if (input.chapterNumber !== undefined) {
      filteredChapters = filteredChapters.filter((c) => c.number === input.chapterNumber);
    }

    if (input.goalStatus) {
      filteredChapters = filteredChapters.filter((c) =>
        (c.goals || []).some((g) => g.status === input.goalStatus),
      );
    }

    if (input.search) {
      const searchLower = input.search.toLowerCase();
      filteredChapters = filteredChapters.filter(
        (c) =>
          c.title.toLowerCase().includes(searchLower) ||
          c.description.toLowerCase().includes(searchLower) ||
          (c.goals || []).some((g) => g.title.toLowerCase().includes(searchLower)) ||
          (c.steps || []).some((s) =>
            (s.prerequisites || []).some((b: IKnowledgeBlock) =>
              b.title.toLowerCase().includes(searchLower),
            ),
          ),
      );
    }

    const totalMatchingChapters = filteredChapters.length;
    const page = input.page || 1;
    const limit = input.limit || 10;
    const startIndex = (page - 1) * limit;
    const paginatedChapters = filteredChapters.slice(startIndex, startIndex + limit);

    return {
      success: true,
      exists: true,
      artifactId: planArtifact.artifactId,
      goal: plan.goal,
      totalChapters: plan.totalChapters,
      matchingChaptersCount: totalMatchingChapters,
      page,
      limit,
      activeChapterId: session.activeChapterId,
      activeStepId: session.activeStepId,
      activeBlockId: session.activeBlockId,
      activeChapterGoalId: session.activeChapterGoalId,
      totalBlocks: session.totalBlocks,
      completedBlocks: session.completedBlocks,
      plan: {
        ...plan,
        chapters: paginatedChapters,
      },
    };
  },
);

const deleteChapterOrGoalTool = defineToolOnce(
  {
    name: "delete_chapter_or_goal",
    description: "Delete a chapter or a specific chapter goal from the study plan.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      chapterId: z.string(),
      goalId: z.string().optional(),
    }),
  },
  async (input) => {
    const { chapterId, goalId } = input;
    const { sessionId, userId } = await resolveSkillContext(input);

    if (!sessionId || !isValidObjectId(sessionId)) {
      throw new Error("Invalid or missing sessionId");
    }

    const session = await StudySession.findById(sessionId).lean();
    if (!session) throw new Error("Session not found");

    const planArtifact = [...(session.artifacts || [])]
      .filter((a) => a.type === "study_plan")
      .sort((a, b) => {
        const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
        const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
        return bTime - aTime;
      })[0];

    if (!planArtifact) throw new Error("Study plan artifact not found");

    const plan = planArtifact.content as StudyPlan;

    if (goalId) {
      // Delete single goal inside chapter
      const chapter = (plan.chapters || []).find((c) => c.chapterId === chapterId);
      if (chapter) {
        chapter.goals = (chapter.goals || []).filter((g) => g.goalId !== goalId);
      }
    } else {
      // Delete whole chapter
      plan.chapters = (plan.chapters || []).filter((c) => c.chapterId !== chapterId);
      plan.totalChapters = plan.chapters.length;
    }

    // Recompute counts
    let sessionTotal = 0;
    let sessionCompleted = 0;
    const completedBlockIds: string[] = [];

    (plan.chapters || []).forEach((ch) => {
      let chCompleted = 0;
      let chTotal = 0;
      (ch.steps || []).forEach((st) => {
        const stCompleted = (st.prerequisites || []).filter(
          (b: IKnowledgeBlock) => b.completed,
        ).length;
        const stTotal = (st.prerequisites || []).length;
        st.completedBlocks = stCompleted;
        st.totalBlocks = stTotal;
        chCompleted += stCompleted;
        chTotal += stTotal;
        (st.prerequisites || []).forEach((b: IKnowledgeBlock) => {
          if (b.completed) completedBlockIds.push(b.blockId);
        });
      });
      ch.completedBlocks = chCompleted;
      ch.totalBlocks = chTotal;
      sessionCompleted += chCompleted;
      sessionTotal += chTotal;
    });

    plan.totalBlocks = sessionTotal;
    plan.completedBlocks = sessionCompleted;
    plan.editedByUser = true;

    await runInTransaction(async (txSession) => {
      const studyPlanDoc = await StudyPlanModel.findOneAndUpdate(
        { sessionId: new Types.ObjectId(sessionId) },
        {
          $set: {
            chapters: plan.chapters,
            totalChapters: plan.totalChapters,
            totalBlocks: sessionTotal,
            completedBlocks: sessionCompleted,
            editedByUser: true,
          },
        },
        { upsert: true, returnDocument: "after", session: txSession },
      );

      await StudySession.findByIdAndUpdate(
        sessionId,
        {
          $set: {
            studyPlan: studyPlanDoc?._id,
            "artifacts.$[plan].content": plan,
            "artifacts.$[plan].updatedAt": new Date(),
            totalBlocks: sessionTotal,
            completedBlocks: sessionCompleted,
            completedBlockIds,
          },
        },
        {
          arrayFilters: [{ "plan.artifactId": planArtifact.artifactId }],
          session: txSession,
        },
      );
    });

    if (userId) {
      publishers.appStudyPlanUpdated(sessionId, userId, plan);
    }

    return {
      success: true,
      deleted: goalId ? "goal" : "chapter",
      totalChapters: plan.totalChapters,
      totalBlocks: sessionTotal,
    };
  },
);

const updateSessionProgressTool = defineToolOnce(
  {
    name: "update_session_progress",
    description:
      "Update the session's active progress to match the student's learning progress. Marks topics or knowledge blocks as completed, advances the active topic/block pointer, and updates progress percentages across the roadmap.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      userId: z.string().optional(),
      completedBlockTitle: z
        .string()
        .optional()
        .describe("The title or concept of the knowledge block to mark as completed"),
      completedBlockId: z
        .string()
        .optional()
        .describe("The ID of the knowledge block to mark as completed"),
      completedStepTitle: z
        .string()
        .optional()
        .describe("The title of the topic / step to mark as completed"),
      completedStepId: z
        .string()
        .optional()
        .describe("The ID of the topic / step to mark as completed"),
      nextTopicTitle: z
        .string()
        .optional()
        .describe("The title of the next topic / step the student is moving to"),
      nextChapterNumber: z
        .number()
        .optional()
        .describe("The chapter number of the next topic"),
      masteryScore: z
        .number()
        .optional()
        .describe("Student's estimated mastery score (0-100) on this topic"),
    }),
  },
  async (input) => {
    const {
      completedBlockTitle,
      completedBlockId,
      completedStepTitle,
      completedStepId,
      nextTopicTitle,
      nextChapterNumber,
      masteryScore,
    } = input;
    const { sessionId, userId } = await resolveSkillContext(input);

    if (!sessionId || !isValidObjectId(sessionId)) {
      throw new Error("Invalid or missing sessionId");
    }

    const session = await StudySession.findById(sessionId).lean();
    if (!session) throw new Error("Session not found");

    let planDoc = await StudyPlanModel.findOne({
      sessionId: new Types.ObjectId(sessionId),
    }).lean();

    const plan: StudyPlan | null = planDoc
      ? (JSON.parse(JSON.stringify(planDoc)) as StudyPlan)
      : null;
    const completedBlockIds = [...(session.completedBlockIds || [])];
    let nextActiveChapterId = session.activeChapterId;
    let nextActiveStepId = session.activeStepId;
    let nextActiveBlockId = session.activeBlockId;

    if (plan && plan.chapters) {
      for (const ch of plan.chapters) {
        const steps = (ch.steps || ch.goals || []) as any[];
        for (const step of steps) {
          if (
            (completedStepId && (step.stepId === completedStepId || step.goalId === completedStepId)) ||
            (completedStepTitle && step.title && step.title.toLowerCase().includes(completedStepTitle.toLowerCase()))
          ) {
            step.isCompleted = true;
            step.status = "completed";
          }

          const blocks = (step.knowledgeBlocks || step.prerequisites || []) as any[];
          for (const b of blocks) {
            const bId = b.blockId || b.id || b._id;
            const bTitle = b.concept || b.title;
            const matchesId = completedBlockId && bId === completedBlockId;
            const matchesTitle =
              completedBlockTitle &&
              bTitle &&
              (bTitle.toLowerCase().includes(completedBlockTitle.toLowerCase()) ||
                completedBlockTitle.toLowerCase().includes(bTitle.toLowerCase()));

            if (matchesId || matchesTitle) {
              b.completed = true;
              b.isCompleted = true;
              b.completedAt = new Date();
              if (bId && !completedBlockIds.includes(String(bId))) {
                completedBlockIds.push(String(bId));
              }
            }
          }

          if (
            nextTopicTitle &&
            step.title &&
            step.title.toLowerCase().includes(nextTopicTitle.toLowerCase())
          ) {
            nextActiveStepId = step.stepId || step.goalId || (step as any)._id;
            nextActiveChapterId = ch.chapterId || (ch as any)._id;
            const firstUnfinished = (step.knowledgeBlocks || step.prerequisites || []).find((b: any) => !b.completed);
            if (firstUnfinished) {
              nextActiveBlockId = firstUnfinished.blockId || (firstUnfinished as any).id;
            }
          }
        }
      }

      let totalBlocks = 0;
      let completedBlocks = 0;
      for (const ch of plan.chapters) {
        for (const step of (ch.steps || ch.goals || []) as any[]) {
          const blocks = (step.knowledgeBlocks || step.prerequisites || []) as any[];
          totalBlocks += blocks.length;
          completedBlocks += blocks.filter((b: any) => b.completed || b.isCompleted).length;
        }
      }

      plan.totalBlocks = totalBlocks;
      plan.completedBlocks = completedBlocks;

      const studyPlanDoc = await StudyPlanModel.findOneAndUpdate(
        { sessionId: new Types.ObjectId(sessionId) },
        {
          $set: {
            chapters: plan.chapters,
            totalBlocks,
            completedBlocks,
          },
        },
        { upsert: true, returnDocument: "after" },
      );

      await StudySession.findByIdAndUpdate(sessionId, {
        $set: {
          studyPlan: studyPlanDoc?._id,
          totalBlocks,
          completedBlocks,
          completedBlockIds,
          activeChapterId: nextActiveChapterId,
          activeStepId: nextActiveStepId,
          activeBlockId: nextActiveBlockId,
        },
      });

      if (userId) {
        publishers.appStudyPlanUpdated(sessionId, userId, plan);
      }

      return {
        success: true,
        completedBlocks,
        totalBlocks,
        progressPercent: totalBlocks > 0 ? Math.round((completedBlocks / totalBlocks) * 100) : 0,
        activeChapterId: nextActiveChapterId,
        activeStepId: nextActiveStepId,
        activeBlockId: nextActiveBlockId,
        nextTopic: nextTopicTitle,
      };
    }

    return { success: true, updated: true };
  },
);

const studyPlanSkill: ISkill = {
  name: "study_plan",
  displayName: "Study Plan",
  description:
    "Assemble, read, update, and track hierarchical study plans with chapters, steps, and knowledge blocks.",
  scope: "session",
  category: "planning",
  tools: [
    getStudyPlanTool,
    generateStudyPlanTool,
    updateStudyPlanTool,
    deleteChapterOrGoalTool,
    updateSessionProgressTool,
    completeKnowledgeBlockTool,
  ],
  phases: [],
  autoEquip: () => true,
};

export default studyPlanSkill;
export { updateSessionProgressTool, completeKnowledgeBlockTool };
