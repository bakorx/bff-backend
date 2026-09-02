import { Types } from "mongoose";
import { StudySession, StudyPlan as StudyPlanModel, Task } from "./models";
import {
  IStudySession,
  ISessionMessage,
  IGoal,
  StudyPlan,
  IStudyChapter,
  IChapterGoal,
  IStudyStep,
  IKnowledgeBlock,
  IDirectiveArtifact,
  ITask,
} from "./interfaces";
import { runInTransaction } from "@/utils";
import { nanoid } from "nanoid";
import { publishers } from "@/socket";
import { setInterrupt } from "./flows/steering";
import { Material, IMaterial } from "@/learning";
import { Upload } from "@/system";
import { isValidObjectId } from "mongoose";
import { emit as emitEvent } from "@/events/services";
// Narrow import, not the @/recommendations barrel — that barrel's
// rule-engine.ts imports @/app, which would cycle straight back here.
import { flagForDelayedRec } from "@/recommendations/delayed-rec";
export const createSession = async (
  userId: string,
  data: Partial<IStudySession>,
): Promise<IStudySession> => {
  return runInTransaction(async (txSession) => {
    const session = new StudySession({
      ...data,
      userId,
      status: "active",
      currentPhase: "idle",
      equippedSkills: [],
    });
    return session.save({ session: txSession });
  });
};

export const updateSession = async (
  sessionId: string,
  updates: Partial<IStudySession>,
): Promise<IStudySession | null> => {
  if (!isValidObjectId(sessionId)) return null;
  return runInTransaction(async (txSession) => {
    return StudySession.findByIdAndUpdate(sessionId, updates, {
      returnDocument: "after",
      session: txSession,
    });
  });
};

export const deleteSession = async (
  sessionId: string,
): Promise<IStudySession | null> => {
  if (!isValidObjectId(sessionId)) return null;
  const session = await runInTransaction(async (txSession) => {
    return StudySession.findByIdAndUpdate(
      sessionId,
      { status: "abandoned", completedAt: new Date() },
      { returnDocument: "after", session: txSession },
    );
  });

  if (session) {
    const userId = String((session as any).userId);
    const abandonedEvent = emitEvent(
      "session:abandoned",
      userId,
      { type: "session", id: sessionId },
      {},
    );

    // §11 "24h-after-flag cron": session abandoned auto-flags a delayed
    // system-tier rec.
    abandonedEvent.then((event) => {
      if (event) {
        flagForDelayedRec(userId, "dashboard", event._id);
      }
    });
  }

  return session;
};

export const startSession = async (
  sessionId: string,
  userId: string,
): Promise<void> => {};

export const sendMessage = async (
  sessionId: string,
  userId: string,
  userName: string,
  message: string,
  messageId?: string,
  type: "text" | "system_action" = "text",
): Promise<ISessionMessage> => {
  if (!isValidObjectId(sessionId))
    throw new Error(`Invalid sessionId: ${sessionId}`);
  const session = await StudySession.findById(sessionId).lean();
  const phase = session?.currentPhase ?? "idle";

  const isOwner = session?.userId?.toString() === userId;

  const messagesList = (session?.messages || []) as any[];
  const lastMsgTime =
    messagesList.length > 0
      ? new Date(messagesList[messagesList.length - 1].timestamp).getTime()
      : 0;
  const now = Date.now();
  const msgTimestamp = new Date(Math.max(now, lastMsgTime + 1));

  const msg: ISessionMessage = {
    messageId: messageId || nanoid(),
    role: isOwner ? "user" : "peer",
    authorId: userId,
    authorName: userName,
    content: message,
    type,
    phase: phase as any,
    timestamp: msgTimestamp,
  };

  const existingMessage = session?.messages?.find(
    (m) => m.messageId === msg.messageId,
  );
  if (existingMessage) return existingMessage;

  await runInTransaction(async (txSession) => {
    await StudySession.findByIdAndUpdate(
      sessionId,
      { $push: { messages: msg } },
      { session: txSession },
    );
  });

  // Content-bearing — private per §6a taxonomy.
  emitEvent(
    "session:message_sent",
    userId,
    { type: "session", id: sessionId },
    { messageId: msg.messageId, role: msg.role, length: message.length },
  );

  return msg;
};

export const retryMessage = async (
  sessionId: string,
  userId: string,
  messageId: string,
): Promise<ISessionMessage> => {
  if (!isValidObjectId(sessionId))
    throw new Error(`Invalid sessionId: ${sessionId}`);
  const session = await StudySession.findById(sessionId).lean();
  const messages = (session?.messages || []) as ISessionMessage[];

  if (messages.length === 0) {
    throw new Error(`No messages found in session ${sessionId} to retry`);
  }

  let targetUserIndex = -1;

  // 1. Check if messageId matches a specific message directly
  const directIdx = messages.findIndex((m) => m.messageId === messageId);
  if (directIdx >= 0) {
    const directMsg = messages[directIdx];
    if (directMsg.role === "user" || directMsg.role === "peer") {
      targetUserIndex = directIdx;
    } else if (directMsg.replyToMessageId) {
      targetUserIndex = messages.findIndex(
        (m) => m.messageId === directMsg.replyToMessageId,
      );
    } else {
      // Find closest preceding user message
      for (let i = directIdx - 1; i >= 0; i--) {
        if (messages[i].role === "user" || messages[i].role === "peer") {
          targetUserIndex = i;
          break;
        }
      }
    }
  }

  // 2. Fallback to the last user message if no direct index found
  if (targetUserIndex < 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user" || messages[i].role === "peer") {
        targetUserIndex = i;
        break;
      }
    }
  }

  if (targetUserIndex < 0) {
    throw new Error(`No user message found in session ${sessionId} to retry`);
  }

  const original = messages[targetUserIndex];
  const updatedMessages = messages.slice(0, targetUserIndex + 1);

  await runInTransaction(async (txSession) => {
    await StudySession.findByIdAndUpdate(
      sessionId,
      { $set: { messages: updatedMessages } },
      { session: txSession },
    );
  });

  return original;
};

export const approvePlan = async (
  sessionId: string,
  userId: string,
  edits?: Record<string, unknown>,
): Promise<IStudySession | null> => {
  if (!isValidObjectId(sessionId))
    throw new Error(`Invalid sessionId: ${sessionId}`);

  return runInTransaction(async (txSession) => {
    const session = await StudySession.findById(sessionId).session(txSession);
    if (!session) throw new Error("Session not found");

    // Find the latest study_plan artifact
    const planArtifact = [...session.artifacts]
      .filter((a) => a.type === "study_plan")
      .sort((a, b) => {
        const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
        const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
        return bTime - aTime;
      })[0];

    if (!planArtifact) {
      // Reconstruct content from the most recent SHOW_PLAN or session metadata
      const showPlanMsg = [...(session.messages as ISessionMessage[])]
        .reverse()
        .find(
          (m) =>
            m.type === "directive" &&
            (m.directive as any)?.type === "SHOW_PLAN",
        );

      const rawSteps: Array<{
        id: string;
        title: string;
        description?: string;
      }> = (showPlanMsg?.directive as any)?.payload?.steps ?? [];

      const recoveredContent: StudyPlan = {
        goal: (showPlanMsg?.directive as any)?.payload?.title ?? session.name,
        courseId: session.courseId ? String(session.courseId) : undefined,
        chapters: [
          {
            chapterId: nanoid(),
            number: 1,
            title: session.name || "Chapter 1",
            description: "Foundational concepts and practice",
            isRecommended: true,
            goals: [
              {
                goalId: nanoid(),
                title: "Master key concepts",
                status: "pending",
              },
            ],
            steps: [
              {
                stepId: nanoid(),
                label: "Step 1",
                order: 1,
                title: "Core Concepts",
                coreIdea: "Master key concepts",
                whyItMatters: "Foundational mastery",
                prerequisites: rawSteps.map((s, idx) => ({
                  blockId: s.id ?? nanoid(),
                  title: s.title,
                  summary: s.description,
                  completed: false,
                  order: idx + 1,
                })),
                completedBlocks: 0,
                totalBlocks: rawSteps.length,
              },
            ],
            completedBlocks: 0,
            totalBlocks: rawSteps.length,
          },
        ],
        totalChapters: 1,
        totalBlocks: rawSteps.length,
        completedBlocks: 0,
        estimatedMinutes: Math.max(rawSteps.length * 15, 30),
        editedByUser: false,
      };

      await StudySession.findByIdAndUpdate(
        sessionId,
        {
          $push: {
            artifacts: {
              artifactId: nanoid(),
              type: "study_plan",
              title: recoveredContent.goal,
              content: recoveredContent,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          },
        },
        { session: txSession },
      );

      // Reload so we can fall through to the standard update path below
      const refreshed =
        await StudySession.findById(sessionId).session(txSession);
      if (!refreshed)
        throw new Error("Session not found after artifact recovery");

      session.artifacts = refreshed.artifacts;
    }

    // Standard path — artifact is guaranteed to exist now
    const artifact = [...session.artifacts]
      .filter((a) => a.type === "study_plan")
      .sort((a, b) => {
        const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
        const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
        return bTime - aTime;
      })[0];

    const content = artifact.content as StudyPlan;

    if (edits?.chapters && Array.isArray(edits.chapters)) {
      content.chapters = edits.chapters as StudyPlan["chapters"];
      content.editedByUser = true;
    }
    content.approvedAt = new Date();

    // Map chapters and steps into session goals
    const goals: IGoal[] = (content.chapters || []).flatMap(
      (ch: IStudyChapter) =>
        (ch.goals || []).map((g: IChapterGoal) => ({
          goalId: g.goalId || nanoid(),
          title: g.title,
          description: g.description,
          status: g.status || "pending",
          artifactIds: [],
        })),
    );

    await StudySession.findByIdAndUpdate(
      sessionId,
      {
        $set: {
          "artifacts.$[plan].content": content,
          "artifacts.$[plan].updatedAt": new Date(),
          goals,
          totalBlocks: content.totalBlocks || 0,
          completedBlocks: content.completedBlocks || 0,
        },
      },
      {
        arrayFilters: [{ "plan.artifactId": artifact.artifactId }],
        session: txSession,
      },
    );

    return StudySession.findById(sessionId).session(txSession).lean();
  });
};

export const steerSession = async (
  sessionId: string,
  userId: string,
  instruction: string,
): Promise<void> => {
  await setInterrupt(sessionId, userId, instruction);
};

export const resumeSession = async (
  sessionId: string,
  userId: string,
): Promise<void> => {};

export const joinSession = async (
  sessionId: string,
  userId: string,
): Promise<IStudySession | null> => {
  if (!isValidObjectId(sessionId)) return null;
  const session = await runInTransaction(async (txSession) => {
    return StudySession.findByIdAndUpdate(
      sessionId,
      {
        $addToSet: {
          peers: { id: new Types.ObjectId(userId), joinedAt: new Date() },
        },
      },
      { returnDocument: "after", session: txSession },
    );
  });

  if (session) {
    // Covers both the self-join route and the host add-peer route (both
    // delegate to this function) — attributed to the joining user in both cases.
    emitEvent(
      "session:joined",
      userId,
      { type: "session", id: sessionId },
      {},
    );
  }

  return session;
};

export const addPeer = async (
  sessionId: string,
  peerId: string,
): Promise<IStudySession | null> => {
  return joinSession(sessionId, peerId);
};

export const removePeer = async (
  sessionId: string,
  peerId: string,
): Promise<IStudySession | null> => {
  if (!isValidObjectId(sessionId)) return null;
  return runInTransaction(async (txSession) => {
    return StudySession.findByIdAndUpdate(
      sessionId,
      { $pull: { peers: { id: new Types.ObjectId(peerId) } } },
      { returnDocument: "after", session: txSession },
    );
  });
};

// ─── MATERIAL & AI GENERATION SERVICES ───────────────────────────────────────

export const createMaterial = async (
  userId: string,
  data: Partial<IMaterial> & { uploadId?: string; sessionId?: string },
): Promise<IMaterial> => {
  return runInTransaction(async (session) => {
    let materialData = { ...data };
    const { sessionId } = data;

    if (data.uploadId) {
      const uploadDoc = await Upload.findById(data.uploadId).session(session);
      if (!uploadDoc) throw new Error("Upload not found");

      materialData = {
        ...materialData,
        upload: uploadDoc._id,
        filename: uploadDoc.originalFilename,
        originalName: uploadDoc.originalFilename,
        mimeType: uploadDoc.mimetype,
        size: uploadDoc.size,
      };
    }

    const material = new Material({
      ...materialData,
      uploadedBy: userId,
      uploadedAt: new Date(),
      isProcessed: false,
      processingStatus: "pending",
    });
    const saved = await material.save({ session });

    if (sessionId) {
      await StudySession.findByIdAndUpdate(
        sessionId,
        { $addToSet: { materialIds: saved._id } },
        { session },
      );
    }

    return saved;
  });
};

export const rateMessage = async (
  sessionId: string,
  messageId: string,
  userId: string,
  rating: 1 | -1,
): Promise<void> => {
  if (!isValidObjectId(sessionId))
    throw new Error(`Invalid sessionId: ${sessionId}`);

  const session = await StudySession.findById(sessionId).lean();
  if (!session) throw new Error("Session not found");
  if (session.userId?.toString() !== userId) throw new Error("Forbidden");

  const msg = session.messages?.find((m) => m.messageId === messageId);
  if (!msg) throw new Error("Message not found");
  if (msg.role !== "z") throw new Error("Only Z messages can be rated");

  await runInTransaction(async (txSession) => {
    await StudySession.updateOne(
      { _id: sessionId, "messages.messageId": messageId },
      { $set: { "messages.$.rating": rating } },
      { session: txSession },
    );
  });
};

export const deleteMaterial = async (
  materialId: string,
  userId: string,
): Promise<void> => {
  await runInTransaction(async (session) => {
    const deleted = await Material.findOneAndDelete(
      { _id: materialId, uploadedBy: userId },
      { session },
    );
    if (!deleted) throw new Error("Material not found or access denied");
  });
};

export interface AnalyticsSummary {
  sessionsByPhase: Record<string, number>;
  totalMessagesSent: number;
  artifactsByType: Record<string, number>;
  avgSessionDurationMinutes: number;
  studyDaysThisMonth: number;
  totalSessions: number;
  completedSessions: number;
  positiveRatings: number;
  negativeRatings: number;
}

export async function getAnalyticsSummary(
  userId: string,
): Promise<AnalyticsSummary> {
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    phaseAgg,
    messageAgg,
    artifactAgg,
    durationAgg,
    studyDaysAgg,
    ratingAgg,
  ] = await Promise.all([
    // Sessions grouped by phase reached
    StudySession.aggregate([
      {
        $match: {
          userId: new (require("mongoose").Types.ObjectId)(userId),
          createdAt: { $gte: ninetyDaysAgo },
        },
      },
      { $group: { _id: "$currentPhase", count: { $sum: 1 } } },
    ]),

    // User messages sent this period
    StudySession.aggregate([
      {
        $match: {
          userId: new (require("mongoose").Types.ObjectId)(userId),
          createdAt: { $gte: ninetyDaysAgo },
        },
      },
      { $unwind: "$messages" },
      { $match: { "messages.role": "user" } },
      { $count: "total" },
    ]),

    // Artifacts grouped by type
    StudySession.aggregate([
      {
        $match: {
          userId: new (require("mongoose").Types.ObjectId)(userId),
          createdAt: { $gte: ninetyDaysAgo },
        },
      },
      { $unwind: { path: "$artifacts", preserveNullAndEmptyArrays: false } },
      { $group: { _id: "$artifacts.type", count: { $sum: 1 } } },
    ]),

    // Average session duration
    StudySession.aggregate([
      {
        $match: {
          userId: new (require("mongoose").Types.ObjectId)(userId),
          durationMinutes: { $gt: 0 },
          createdAt: { $gte: ninetyDaysAgo },
        },
      },
      { $group: { _id: null, avg: { $avg: "$durationMinutes" } } },
    ]),

    // Distinct study days this month
    StudySession.aggregate([
      {
        $match: {
          userId: new (require("mongoose").Types.ObjectId)(userId),
          createdAt: { $gte: monthStart },
        },
      },
      {
        $group: {
          _id: {
            y: { $year: "$createdAt" },
            m: { $month: "$createdAt" },
            d: { $dayOfMonth: "$createdAt" },
          },
        },
      },
      { $count: "days" },
    ]),

    // Z message ratings
    StudySession.aggregate([
      {
        $match: {
          userId: new (require("mongoose").Types.ObjectId)(userId),
          createdAt: { $gte: ninetyDaysAgo },
        },
      },
      { $unwind: "$messages" },
      {
        $match: { "messages.role": "z", "messages.rating": { $exists: true } },
      },
      { $group: { _id: "$messages.rating", count: { $sum: 1 } } },
    ]),
  ]);

  const sessionsByPhase: Record<string, number> = {};
  let totalSessions = 0;
  let completedSessions = 0;
  for (const { _id, count } of phaseAgg) {
    sessionsByPhase[_id ?? "unknown"] = count;
    totalSessions += count;
    if (_id === "complete") completedSessions = count;
  }

  const artifactsByType: Record<string, number> = {};
  for (const { _id, count } of artifactAgg) {
    if (_id) artifactsByType[_id] = count;
  }

  const positiveRatings =
    ratingAgg.find((r: { _id: number }) => r._id === 1)?.count ?? 0;
  const negativeRatings =
    ratingAgg.find((r: { _id: number }) => r._id === -1)?.count ?? 0;

  return {
    sessionsByPhase,
    totalMessagesSent: messageAgg[0]?.total ?? 0,
    artifactsByType,
    avgSessionDurationMinutes: Math.round(durationAgg[0]?.avg ?? 0),
    studyDaysThisMonth: studyDaysAgg[0]?.days ?? 0,
    totalSessions,
    completedSessions,
    positiveRatings,
    negativeRatings,
  };
}

// ─── Study Plan Management & Granular Navigation Services ──────────────────────

function getActivePlanArtifact(session: IStudySession) {
  const planArtifact = [...(session.artifacts || [])]
    .filter((a) => a.type === "study_plan")
    .sort((a, b) => {
      const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
      const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
      return bTime - aTime;
    })[0];
  return planArtifact;
}

function recalculatePlanTotals(plan: StudyPlan): {
  totalBlocks: number;
  completedBlocks: number;
  completedBlockIds: string[];
} {
  let totalBlocks = 0;
  let completedBlocks = 0;
  const completedBlockIds: string[] = [];

  for (const chapter of plan.chapters || []) {
    let chTotal = 0;
    let chCompleted = 0;

    for (const step of chapter.steps || []) {
      const stCompleted = (step.prerequisites || []).filter(
        (b: IKnowledgeBlock) => b.completed,
      ).length;
      const stTotal = (step.prerequisites || []).length;
      step.completedBlocks = stCompleted;
      step.totalBlocks = stTotal;

      chCompleted += stCompleted;
      chTotal += stTotal;

      for (const block of step.prerequisites || []) {
        if (block.completed) completedBlockIds.push(block.blockId);
      }
    }

    chapter.completedBlocks = chCompleted;
    chapter.totalBlocks = chTotal;

    for (const goal of chapter.goals || []) {
      if (chCompleted >= chTotal && chTotal > 0) {
        goal.status = "completed";
        goal.completedAt = new Date();
      }
    }

    totalBlocks += chTotal;
    completedBlocks += chCompleted;
  }

  plan.totalBlocks = totalBlocks;
  plan.completedBlocks = completedBlocks;
  plan.totalChapters = (plan.chapters || []).length;

  return { totalBlocks, completedBlocks, completedBlockIds };
}

async function saveStudyPlanState(
  sessionId: string,
  session: IStudySession,
  plan: StudyPlan,
  planArtifactId: string,
  extraSet: Record<string, any> = {},
  txSession?: any,
) {
  const studyPlanDoc = await StudyPlanModel.findOneAndUpdate(
    { sessionId: new Types.ObjectId(sessionId) },
    {
      $set: {
        sessionId: new Types.ObjectId(sessionId),
        userId: session.userId,
        courseId: session.courseId,
        goal: plan.goal,
        chapters: plan.chapters,
        totalChapters: plan.totalChapters,
        totalBlocks: plan.totalBlocks,
        completedBlocks: plan.completedBlocks,
        estimatedMinutes: plan.estimatedMinutes,
        approvedAt: plan.approvedAt,
        editedByUser: plan.editedByUser,
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
        ...extraSet,
      },
    },
    {
      arrayFilters: [{ "plan.artifactId": planArtifactId }],
      session: txSession,
    },
  );

  return studyPlanDoc;
}

export const toggleBlockCompletion = async (
  sessionId: string,
  blockId: string,
  userId?: string,
) => {
  return runInTransaction(async (txSession) => {
    const session = await StudySession.findById(sessionId).session(txSession);
    if (!session) throw new Error("Session not found");

    const planArtifact = getActivePlanArtifact(session);
    if (!planArtifact) throw new Error("Study plan not found");

    const plan = planArtifact.content as StudyPlan;
    let targetBlock: IKnowledgeBlock | undefined;
    let targetChapter: IStudyChapter | undefined;

    for (const chapter of plan.chapters || []) {
      for (const step of chapter.steps || []) {
        for (const block of step.prerequisites || []) {
          if (block.blockId === blockId) {
            block.completed = !block.completed;
            block.completedAt = block.completed ? new Date() : undefined;
            targetBlock = block;
            targetChapter = chapter;
          }
        }
      }
    }

    if (!targetBlock) throw new Error("Knowledge block not found");

    const { totalBlocks, completedBlocks, completedBlockIds } =
      recalculatePlanTotals(plan);

    await saveStudyPlanState(
      sessionId,
      session,
      plan,
      planArtifact.artifactId,
      {
        totalBlocks,
        completedBlocks,
        completedBlockIds,
      },
      txSession,
    );

    if (userId) {
      publishers.appBlockCompleted(sessionId, userId, {
        blockId,
        completed: targetBlock.completed,
        chapterId: targetChapter?.chapterId || "",
        chapterProgress: {
          completed: targetChapter?.completedBlocks || 0,
          total: targetChapter?.totalBlocks || 0,
        },
        sessionProgress: {
          completed: completedBlocks,
          total: totalBlocks,
        },
      });
      publishers.appStudyPlanUpdated(sessionId, userId, plan);
    }

    return {
      blockId,
      completed: targetBlock.completed,
      chapterId: targetChapter?.chapterId,
      totalBlocks,
      completedBlocks,
    };
  });
};

export const updateChapter = async (
  sessionId: string,
  chapterId: string,
  data: Partial<IStudyChapter>,
) => {
  return runInTransaction(async (txSession) => {
    const session = await StudySession.findById(sessionId).session(txSession);
    if (!session) throw new Error("Session not found");

    const planArtifact = getActivePlanArtifact(session);
    if (!planArtifact) throw new Error("Study plan not found");

    const plan = planArtifact.content as StudyPlan;
    const chapter = (plan.chapters || []).find(
      (c) => c.chapterId === chapterId,
    );
    if (!chapter) throw new Error("Chapter not found");

    if (data.title !== undefined) chapter.title = data.title;
    if (data.description !== undefined) chapter.description = data.description;
    if (data.isRecommended !== undefined)
      chapter.isRecommended = data.isRecommended;

    plan.editedByUser = true;

    await saveStudyPlanState(
      sessionId,
      session,
      plan,
      planArtifact.artifactId,
      {},
      txSession,
    );

    return chapter;
  });
};

export const addChapter = async (
  sessionId: string,
  data: { title: string; description?: string },
) => {
  return runInTransaction(async (txSession) => {
    const session = await StudySession.findById(sessionId).session(txSession);
    if (!session) throw new Error("Session not found");

    const planArtifact = getActivePlanArtifact(session);
    if (!planArtifact) throw new Error("Study plan not found");

    const plan = planArtifact.content as StudyPlan;
    const nextNumber = (plan.chapters || []).length + 1;
    const chapterId = nanoid();

    const newChapter: IStudyChapter = {
      chapterId,
      number: nextNumber,
      title: data.title,
      description: data.description || "",
      isRecommended: false,
      goals: [
        {
          goalId: nanoid(),
          title: `Complete ${data.title}`,
          status: "pending",
        },
      ],
      steps: [
        {
          stepId: nanoid(),
          label: "Step 1",
          order: 1,
          title: data.title,
          coreIdea: data.description || "Core concepts",
          whyItMatters: "Foundational mastery",
          prerequisites: [],
          completedBlocks: 0,
          totalBlocks: 0,
        },
      ],
      completedBlocks: 0,
      totalBlocks: 0,
    };

    plan.chapters.push(newChapter);
    plan.totalChapters = plan.chapters.length;
    plan.editedByUser = true;

    await saveStudyPlanState(
      sessionId,
      session,
      plan,
      planArtifact.artifactId,
      {},
      txSession,
    );

    return newChapter;
  });
};

export const addChapterGoal = async (
  sessionId: string,
  chapterId: string,
  data: { title: string; description?: string },
) => {
  return runInTransaction(async (txSession) => {
    const session = await StudySession.findById(sessionId).session(txSession);
    if (!session) throw new Error("Session not found");

    const planArtifact = getActivePlanArtifact(session);
    if (!planArtifact) throw new Error("Study plan not found");

    const plan = planArtifact.content as StudyPlan;
    const chapter = (plan.chapters || []).find(
      (c) => c.chapterId === chapterId,
    );
    if (!chapter) throw new Error("Chapter not found");

    const newGoal: IChapterGoal = {
      goalId: nanoid(),
      title: data.title,
      description: data.description,
      status: "pending",
    };

    chapter.goals.push(newGoal);
    plan.editedByUser = true;

    await saveStudyPlanState(
      sessionId,
      session,
      plan,
      planArtifact.artifactId,
      {},
      txSession,
    );

    return newGoal;
  });
};

export const updateChapterGoal = async (
  sessionId: string,
  chapterId: string,
  goalId: string,
  data: Partial<IChapterGoal>,
) => {
  return runInTransaction(async (txSession) => {
    const session = await StudySession.findById(sessionId).session(txSession);
    if (!session) throw new Error("Session not found");

    const planArtifact = getActivePlanArtifact(session);
    if (!planArtifact) throw new Error("Study plan not found");

    const plan = planArtifact.content as StudyPlan;
    const chapter = (plan.chapters || []).find(
      (c) => c.chapterId === chapterId,
    );
    if (!chapter) throw new Error("Chapter not found");

    const goal = (chapter.goals || []).find((g) => g.goalId === goalId);
    if (!goal) throw new Error("Goal not found");

    if (data.title !== undefined) goal.title = data.title;
    if (data.description !== undefined) goal.description = data.description;
    if (data.status !== undefined) {
      goal.status = data.status;
      if (data.status === "completed") goal.completedAt = new Date();
    }

    plan.editedByUser = true;

    await saveStudyPlanState(
      sessionId,
      session,
      plan,
      planArtifact.artifactId,
      {},
      txSession,
    );

    return goal;
  });
};

export const deleteChapterGoal = async (
  sessionId: string,
  chapterId: string,
  goalId: string,
) => {
  return runInTransaction(async (txSession) => {
    const session = await StudySession.findById(sessionId).session(txSession);
    if (!session) throw new Error("Session not found");

    const planArtifact = getActivePlanArtifact(session);
    if (!planArtifact) throw new Error("Study plan not found");

    const plan = planArtifact.content as StudyPlan;
    const chapter = (plan.chapters || []).find(
      (c) => c.chapterId === chapterId,
    );
    if (!chapter) throw new Error("Chapter not found");

    chapter.goals = (chapter.goals || []).filter((g) => g.goalId !== goalId);
    plan.editedByUser = true;

    await saveStudyPlanState(
      sessionId,
      session,
      plan,
      planArtifact.artifactId,
      {},
      txSession,
    );

    return { success: true, deletedGoalId: goalId };
  });
};

export const respondToArtifact = async (
  sessionId: string,
  artifactId: string,
  responseData: Record<string, unknown>,
  userId?: string,
) => {
  return runInTransaction(async (txSession) => {
    const session = await StudySession.findById(sessionId).session(txSession);
    if (!session) throw new Error("Session not found");

    const artifact = (session.artifacts || []).find(
      (a) => a.artifactId === artifactId,
    );
    if (!artifact) throw new Error("Artifact not found");

    const currentContent = (artifact.content || {}) as unknown as Record<
      string,
      unknown
    >;

    const answers =
      responseData.answers ||
      responseData.userAnswers ||
      (responseData.selectedOption ? [responseData.selectedOption] : []) ||
      (responseData.answer ? [responseData.answer] : []);

    const updatedContent: any = {
      ...currentContent,
      userAnswers: answers,
      selectedOption: responseData.selectedOption ?? responseData.answer,
      submittedAnswer: responseData.answer ?? responseData.submittedAnswer,
      response: responseData,
      score: responseData.score ?? currentContent.score,
      feedback: responseData.feedback ?? currentContent.feedback,
      resolved: true,
      status: "completed",
      respondedAt: new Date(),
    };

    artifact.content = updatedContent;
    artifact.updatedAt = new Date();

    await StudySession.findByIdAndUpdate(
      sessionId,
      {
        $set: {
          "artifacts.$[art].content": artifact.content,
          "artifacts.$[art].updatedAt": new Date(),
          "messages.$[msg].artifact": artifact,
        },
      },
      {
        arrayFilters: [
          { "art.artifactId": artifactId },
          { "msg.artifactId": artifactId },
        ],
        session: txSession,
      },
    );

    if (userId) {
      publishers.appArtifactUpdated(sessionId, userId, artifact);
    }

    return artifact;
  });
};

export const respondToDirectiveArtifact = respondToArtifact;

export const continueJourney = async (
  sessionId: string,
  userId: string,
  payload: {
    chapterId?: string;
    stepId?: string;
    blockId?: string;
    chapterNumber?: number;
    topicTitle?: string;
  },
) => {
  return runInTransaction(async (txSession) => {
    const session = await StudySession.findById(sessionId)
      .populate("studyPlan")
      .session(txSession);
    if (!session) throw new Error("Session not found");

    const studyPlan = session.studyPlan as any;
    const chapters: any[] = studyPlan?.chapters || [];

    // Find target chapter
    let targetChapter = payload.chapterId
      ? chapters.find(
          (c) =>
            c.chapterId === payload.chapterId ||
            String(c._id) === payload.chapterId,
        )
      : payload.chapterNumber
        ? chapters.find((c) => c.chapterNumber === payload.chapterNumber)
        : chapters.find((c) => c.isRecommended) || chapters[0];

    if (!targetChapter && chapters.length > 0) {
      targetChapter = chapters[0];
    }

    const steps: any[] = targetChapter?.steps || [];

    // Find target step
    let targetStep = payload.stepId
      ? steps.find(
          (s) =>
            s.stepId === payload.stepId || String(s._id) === payload.stepId,
        )
      : payload.topicTitle
        ? steps.find((s) => s.title === payload.topicTitle)
        : steps[0];

    if (!targetStep && steps.length > 0) {
      targetStep = steps[0];
    }

    const prerequisites: any[] = targetStep?.prerequisites || [];
    const targetBlock = payload.blockId
      ? prerequisites.find(
          (b) =>
            b.blockId === payload.blockId ||
            String(b._id) === payload.blockId,
        )
      : prerequisites.find((b) => !b.completed) || prerequisites[0];

    const activeChapterId =
      targetChapter?.chapterId || payload.chapterId || session.activeChapterId;
    const activeStepId =
      targetStep?.stepId || payload.stepId || session.activeStepId;
    const activeBlockId =
      targetBlock?.blockId || payload.blockId || session.activeBlockId;

    await StudySession.findByIdAndUpdate(
      sessionId,
      {
        $set: {
          activeChapterId,
          activeStepId,
          activeBlockId,
        },
      },
      { session: txSession },
    );

    return {
      success: true,
      activePointers: {
        chapterId: activeChapterId,
        stepId: activeStepId,
        blockId: activeBlockId,
      },
      chapter: targetChapter,
      step: targetStep,
      block: targetBlock,
    };
  });
};

// ─── Study task ───────────────────────────────────────────────────────────────

export const createTask = async (
  userId: string,
  data: { title: string; subject?: string },
): Promise<ITask> => {
  return Task.create({
    userId: new Types.ObjectId(userId),
    title: data.title,
    subject: data.subject,
  });
};

export const updateTask = async (
  userId: string,
  taskId: string,
  data: { title?: string; subject?: string; status?: "active" | "completed" },
): Promise<ITask | null> => {
  const update: Record<string, unknown> = { ...data };
  // completedAt tracks the status transition, not just the status value —
  // set on the way to "completed", cleared on the way back to "active".
  if (data.status === "completed") update.completedAt = new Date();
  if (data.status === "active") update.completedAt = null;

  return Task.findOneAndUpdate(
    {
      _id: taskId,
      userId: new Types.ObjectId(userId),
      isDeleted: { $ne: true },
    },
    { $set: update },
    { returnDocument: "after" },
  );
};

export const deleteTask = async (
  userId: string,
  taskId: string,
): Promise<boolean> => {
  const deleted = await Task.findOneAndUpdate(
    {
      _id: taskId,
      userId: new Types.ObjectId(userId),
      isDeleted: { $ne: true },
    },
    { $set: { isDeleted: true, deletedAt: new Date() } },
  );
  return !!deleted;
};
