import { Request, Response } from "express";
import { nanoid } from "nanoid";
import { Types } from "mongoose";
import * as services from "./services";
import * as selectors from "./selectors";
import { AppSerializers } from "./serializers";
import { MemoryServices } from "./memory/services";
import { sendSuccess, sendError } from "@/utils";
import { IStudySession } from "./interfaces";
import { longQueue } from "@/schedulers";
import {
  Course,
  FlashcardSet,
  PersonalQuiz,
  MindMap,
  Note,
  Material,
  LibraryMaterial,
  selectors as learningSelectors,
} from "@/learning";
import { StudyPlan, StudySession, Task } from "./models";
import { User } from "@/users";
import { redisConnection } from "@/config";
import { consumeUsage, CREDIT_COSTS, FeatureKey } from "@/subscriptions";
import { emit as emitEvent } from "@/events/services";

function isOwnedByUser(docUserId: unknown, userId: string): boolean {
  return String(docUserId) === String(userId);
}

const sendQuotaExceeded = (res: Response, feature: FeatureKey) => {
  const creditCost = CREDIT_COSTS[feature];
  return res.status(402).json({
    success: false,
    message: "Daily limit reached",
    data: null,
    error: {
      code: "QUOTA_EXCEEDED",
      feature,
      creditsRequired: creditCost,
    },
  });
};

const consumeUsageOnSuccess = async (
  req: Request,
  res: Response,
  feature: FeatureKey,
): Promise<boolean> => {
  const userId = req.user?.id ?? (req.user as any)?._id;
  if (!userId) {
    sendError(res, "Unauthorized", 401);
    return false;
  }

  if (req.user?.role === "super_admin") {
    res.locals.usageResult = { allowed: true, remaining: null, source: "plan" };
    return true;
  }

  const result = await consumeUsage(userId, feature);
  if (!result.allowed) {
    sendQuotaExceeded(res, feature);
    return false;
  }

  res.locals.usageResult = result;
  return true;
};

export const createSession = async (req: Request, res: Response) => {
  try {
    if (!(await consumeUsageOnSuccess(req, res, "tutorSessions"))) return;
    const session = await services.createSession(req.user!.id, req.body);
    sendSuccess(
      res,
      "Session created.",
      AppSerializers.session(session as unknown as IStudySession),
      null,
      201,
    );
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to create session",
      500,
    );
  }
};

export const getSessions = async (req: Request, res: Response) => {
  try {
    const sessions = await selectors.getSessionsByUser(req.user!.id, req.query);
    sendSuccess(
      res,
      "Sessions retrieved.",
      (sessions as unknown as IStudySession[]).map(
        AppSerializers.sessionSummary,
      ),
    );
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to get sessions",
      500,
    );
  }
};

export const getSession = async (req: Request, res: Response) => {
  try {
    const session = await selectors.getSessionById(req.params.id as string);
    if (!session) return sendError(res, "Session not found", 404);

    const isOwner = isOwnedByUser(session.userId, req.user!.id);
    const isPeer = session.peers?.some(
      (p: any) => p.id.toString() === req.user!.id,
    );

    if (!isOwner && !isPeer) {
      return sendError(res, "Forbidden", 403);
    }

    // Fetch notes for this session (only user's own unless we want shared)
    const sessionNotes = await Note.find({
      sessionId: req.params.id as string,
      userId: req.user!.id,
      isDeleted: { $ne: true },
    }).sort({ updatedAt: -1 });

    const serialized = AppSerializers.session(
      session as unknown as IStudySession,
    );

    // Inject studio-specific data expected by frontend IZStudyPartnerApp
    const sessionObj = session as any;
    const finalResponse = {
      ...serialized,
      notes: sessionNotes.map((n: any) => ({
        id: n._id.toString(),
        title: n.title,
        content: n.content,
        generatedByZ: n.generatedByZ,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      })),
      sharedNotes: sessionObj.studio?.sharedNotes || [],
      mindMap: sessionObj.studio?.mindMap || null,
      exports: (sessionObj.studio?.exportedFiles || []).map((e: any) => ({
        id: e.exportId,
        type: e.type,
        url: e.url,
        createdAt: e.generatedAt,
      })),
      // Flashcards and Quizzes are already in artifacts, but we can also sync saved status here if needed
    };

    sendSuccess(res, "Session retrieved.", finalResponse);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to get session",
      500,
    );
  }
};

export const getSessionMaterials = async (req: Request, res: Response) => {
  try {
    const session = await StudySession.findById(req.params.id);
    if (!session) return sendError(res, "Session not found", 404);

    const isOwner = isOwnedByUser(session.userId, req.user!.id);
    const isPeer = session.peers?.some(
      (p: any) => p.id.toString() === req.user!.id,
    );

    if (!isOwner && !isPeer) {
      return sendError(res, "Forbidden", 403);
    }

    const materials = await Material.find({
      _id: { $in: session.materialIds || [] },
      isDeleted: { $ne: true },
    }).lean();

    sendSuccess(
      res,
      "Materials retrieved.",
      (materials as any).map(AppSerializers.materialSerializer),
    );
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to get session materials",
      500,
    );
  }
};

export const addAppMaterial = async (req: Request, res: Response) => {
  try {
    const { id: sessionId } = req.params;
    const { materialId } = req.body;

    const session = await StudySession.findById(sessionId);
    if (!session) return sendError(res, "Session not found", 404);

    const isOwner = isOwnedByUser(session.userId, req.user!.id);
    const isPeer = session.peers?.some(
      (p: any) => p.id.toString() === req.user!.id,
    );
    if (!isOwner && !isPeer) return sendError(res, "Forbidden", 403);

    const material = await Material.findById(materialId);
    if (!material) return sendError(res, "Material not found", 404);

    await Promise.all([
      StudySession.findByIdAndUpdate(sessionId, {
        $addToSet: { materialIds: material._id },
      }),
      Material.findByIdAndUpdate(material._id, {
        $set: { sessionId: new Types.ObjectId(sessionId as string) },
      }),
    ]);

    // Reload session to get updated materialIds
    const updatedSession = await StudySession.findById(sessionId).lean();
    // Enqueue course summary generation/merge job
    await longQueue.enqueue("ai:generate_course_summary", {
      sessionId,
      userId: req.user!.id,
      materialIds: (updatedSession?.materialIds || []).map(String),
      courseId: updatedSession?.courseId ? String(updatedSession.courseId) : undefined,
    });

    sendSuccess(res, "Material added to session.");
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to add material",
      500,
    );
  }
};

export const removeAppMaterial = async (req: Request, res: Response) => {
  try {
    const { id: sessionId, materialId } = req.params;

    const session = await StudySession.findById(sessionId);
    if (!session) return sendError(res, "Session not found", 404);

    const isOwner = isOwnedByUser(session.userId, req.user!.id);
    if (!isOwner) return sendError(res, "Forbidden", 403);

    await Promise.all([
      StudySession.findByIdAndUpdate(sessionId, {
        $pull: { materialIds: new Types.ObjectId(materialId as string) },
      }),
      Material.findByIdAndUpdate(materialId, {
        $unset: { sessionId: "" },
      }),
    ]);

    // Reload session to get updated materialIds
    const updatedRemoveSession = await StudySession.findById(sessionId).lean();
    // Enqueue course summary update job
    await longQueue.enqueue("ai:generate_course_summary", {
      sessionId,
      userId: req.user!.id,
      materialIds: (updatedRemoveSession?.materialIds || []).map(String),
      courseId: updatedRemoveSession?.courseId ? String(updatedRemoveSession.courseId) : undefined,
    });

    sendSuccess(res, "Material removed from session.");
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to remove material",
      500,
    );
  }
};

export const addHighlight = async (req: Request, res: Response) => {
  try {
    const { id: sessionId } = req.params;
    const highlight = req.body;

    const session = await StudySession.findById(sessionId);
    if (!session) return sendError(res, "Session not found", 404);

    const isOwner = isOwnedByUser(session.userId, req.user!.id);
    const isPeer = session.peers?.some(
      (p: any) => p.id.toString() === req.user!.id,
    );
    if (!isOwner && !isPeer) return sendError(res, "Forbidden", 403);

    const newHighlight = { ...highlight, id: nanoid() };
    await StudySession.findByIdAndUpdate(sessionId, {
      $push: { highlights: newHighlight },
    });

    // Covers both session:highlight_added (§6a "Study sessions") and
    // highlight:saved (§6a "Notes & highlights") — there's no standalone
    // Highlight feature, both taxonomy entries map to this one action.
    // Emitting only the session-scoped type avoids double-counting the
    // same user action as two bus events.
    emitEvent(
      "session:highlight_added",
      req.user!.id,
      { type: "session", id: sessionId as string },
      { highlightId: newHighlight.id, materialId: newHighlight.materialId },
    );

    sendSuccess(res, "Highlight added.", newHighlight);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to add highlight",
      500,
    );
  }
};

export const removeHighlight = async (req: Request, res: Response) => {
  try {
    const { id: sessionId, highlightId } = req.params;

    const session = await StudySession.findById(sessionId);
    if (!session) return sendError(res, "Session not found", 404);

    const isOwner = isOwnedByUser(session.userId, req.user!.id);
    if (!isOwner) return sendError(res, "Forbidden", 403);

    await StudySession.findByIdAndUpdate(sessionId, {
      $pull: { highlights: { id: highlightId } },
    });

    sendSuccess(res, "Highlight removed.");
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to remove highlight",
      500,
    );
  }
};

export const updateHighlight = async (req: Request, res: Response) => {
  try {
    const { id: sessionId, highlightId } = req.params;
    const { note, color } = req.body;

    const session = await StudySession.findById(sessionId);
    if (!session) return sendError(res, "Session not found", 404);

    const isOwner = isOwnedByUser(session.userId, req.user!.id);
    const isPeer = session.peers?.some(
      (p: any) => p.id.toString() === req.user!.id,
    );
    if (!isOwner && !isPeer) return sendError(res, "Forbidden", 403);

    const updatedSession = await StudySession.findOneAndUpdate(
      { _id: sessionId, "highlights.id": highlightId },
      {
        $set: {
          "highlights.$.note": note,
          "highlights.$.color": color,
        },
      },
      { returnDocument: "after" },
    );

    if (!updatedSession) return sendError(res, "Highlight not found", 404);
    const updatedHighlight = (updatedSession as any).highlights.find(
      (h: any) => h.id === highlightId,
    );

    emitEvent(
      "highlight:updated",
      req.user!.id,
      { type: "session", id: sessionId as string },
      { highlightId, note, color },
    );

    sendSuccess(res, "Highlight updated.", updatedHighlight);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to update highlight",
      500,
    );
  }
};

export const joinSession = async (req: Request, res: Response) => {
  try {
    const session = await services.joinSession(
      req.params.id as string,
      req.user!.id,
    );
    if (!session) return sendError(res, "Session not found", 404);
    sendSuccess(res, "Joined session successfully", session);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to join session",
      500,
    );
  }
};

export const getAllSessions = async (req: Request, res: Response) => {
  try {
    const sessions = await selectors.getAllSessions(req.query);
    sendSuccess(
      res,
      "All sessions retrieved.",
      (sessions as unknown as IStudySession[]).map(
        AppSerializers.sessionSummary,
      ),
    );
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to get sessions",
      500,
    );
  }
};

export const startSession = async (req: Request, res: Response) => {
  try {
    await services.startSession(req.params.id as string, req.user!.id);
    await longQueue.enqueue("app:session:trigger", {
      sessionId: req.params.id as string,
      userId: req.user!.id,
      trigger: "start",
      payload: {},
    });

    emitEvent(
      "session:started",
      req.user!.id,
      { type: "session", id: req.params.id as string },
      {},
    );

    sendSuccess(res, "Session starting. Z is initialising.");
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to start session",
      500,
    );
  }
};

export const sendMessage = async (req: Request, res: Response) => {
  try {
    const { message: content, messageId, isSystemAction, type } = req.body;
    const msgType = type || (isSystemAction ? "system_action" : "text");
    const msg = await services.sendMessage(
      req.params.id as string,
      req.user!.id,
      req.user!.name,
      content,
      messageId,
      msgType,
    );
    await longQueue.enqueue("app:session:trigger", {
      sessionId: req.params.id as string,
      userId: req.user!.id,
      trigger: msgType === "system_action" ? "system_action" : "user_message",
      payload: { message: content, isSystemAction: Boolean(isSystemAction), ...msg },
    });
    sendSuccess(res, "Message sent.");
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to send message",
      500,
    );
  }
};

export const retryMessage = async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id as string;
    const messageId = req.params.messageId as string;
    const msg = await services.retryMessage(sessionId, req.user!.id, messageId);
    await longQueue.enqueue(
      "app:session:trigger",
      {
        sessionId,
        userId: req.user!.id,
        trigger: "user_message",
        payload: { ...msg, message: msg.content },
      },
      3,
      `retry_${messageId}`,
    );
    sendSuccess(res, "Retry queued.");
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to retry message",
      500,
    );
  }
};

export const approvePlan = async (req: Request, res: Response) => {
  try {
    await services.approvePlan(
      req.params.id as string,
      req.user!.id,
      req.body.edits,
    );
    await longQueue.enqueue("app:session:trigger", {
      sessionId: req.params.id as string,
      userId: req.user!.id,
      trigger: "approve_plan",
      payload: req.body.edits ? { edits: req.body.edits } : {},
    });
    sendSuccess(res, "Plan approved.");
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to approve plan",
      500,
    );
  }
};

export const steerSession = async (req: Request, res: Response) => {
  try {
    await services.steerSession(
      req.params.id as string,
      req.user!.id,
      req.body.instruction,
    );
    sendSuccess(res, "Steering instruction received.", null, null, 202);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to steer session",
      500,
    );
  }
};

export const resumeSession = async (req: Request, res: Response) => {
  try {
    await services.resumeSession(req.params.id as string, req.user!.id);
    await longQueue.enqueue("app:session:trigger", {
      sessionId: req.params.id as string,
      userId: req.user!.id,
      trigger: "resume",
      payload: {},
    });
    sendSuccess(res, "Session resuming.");
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to resume session",
      500,
    );
  }
};

export const deleteSession = async (req: Request, res: Response) => {
  try {
    await services.deleteSession(req.params.id as string);
    sendSuccess(res, "Session deleted.");
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to delete session",
      500,
    );
  }
};

export const addPeer = async (req: Request, res: Response) => {
  try {
    await services.addPeer(req.params.id as string, req.body.peerId as string);
    sendSuccess(res, "Peer added.");
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to add peer",
      500,
    );
  }
};

export const removePeer = async (req: Request, res: Response) => {
  try {
    await services.removePeer(
      req.params.id as string,
      req.params.peerId as string,
    );
    sendSuccess(res, "Peer removed.");
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to remove peer",
      500,
    );
  }
};

export const getMemory = async (req: Request, res: Response) => {
  try {
    const memory = await MemoryServices.snapshot(
      req.user!.id,
      req.query.courseId as string | undefined,
    );
    if (!memory) return sendError(res, "Memory not found", 404);
    sendSuccess(res, "Memory retrieved.", AppSerializers.memory(memory));
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to get memory",
      500,
    );
  }
};

export const getFlashcards = async (req: Request, res: Response) => {
  try {
    const data = await FlashcardSet.aggregate([
      {
        $match: {
          createdBy: new Types.ObjectId(req.user!.id),
          isDeleted: { $ne: true },
        },
      },
      {
        $lookup: {
          from: "courses",
          localField: "courseId",
          foreignField: "_id",
          as: "course",
        },
      },
      {
        $unwind: {
          path: "$course",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          _id: 0,
          id: { $toString: "$_id" },
          title: 1,
          courseTitle: "$course.title",
          courseCode: "$course.code",
          cardCount: {
            $ifNull: ["$cardCount", { $size: { $ifNull: ["$cards", []] } }],
          },
          tags: { $ifNull: ["$tags", []] },
          createdAt: 1,
        },
      },
      { $sort: { createdAt: -1 } },
    ]);

    sendSuccess(res, "Flashcard sets retrieved.", data);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to get flashcard sets",
      500,
    );
  }
};

export const getFlashcardSet = async (req: Request, res: Response) => {
  try {
    const data = await FlashcardSet.aggregate([
      {
        $match: {
          _id: new Types.ObjectId(String(req.params.flashcardId)),
          createdBy: new Types.ObjectId(req.user!.id),
          isDeleted: { $ne: true },
        },
      },
      {
        $lookup: {
          from: "courses",
          localField: "courseId",
          foreignField: "_id",
          as: "course",
        },
      },
      {
        $unwind: {
          path: "$course",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          _id: 0,
          id: { $toString: "$_id" },
          title: 1,
          courseTitle: "$course.title",
          courseCode: "$course.code",
          cards: {
            $map: {
              input: { $ifNull: ["$cards", []] },
              as: "card",
              in: {
                id: "$$card.cardId",
                front: "$$card.front",
                back: "$$card.back",
                createdAt: { $ifNull: ["$updatedAt", "$createdAt"] },
              },
            },
          },
          tags: { $ifNull: ["$tags", []] },
          createdAt: 1,
        },
      },
      { $limit: 1 },
    ]);

    if (!data.length) return sendError(res, "Flashcard set not found", 404);

    sendSuccess(res, "Flashcard set retrieved.", data[0]);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to get flashcard set",
      500,
    );
  }
};

export const deleteFlashcardSet = async (req: Request, res: Response) => {
  try {
    const deleted = await FlashcardSet.findOneAndUpdate(
      {
        _id: req.params.flashcardId as string,
        createdBy: req.user!.id,
        isDeleted: { $ne: true },
      },
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!deleted) return sendError(res, "Flashcard set not found", 404);
    sendSuccess(res, "Flashcard set deleted.");
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to delete flashcard set",
      500,
    );
  }
};

export const addFlashcardCard = async (req: Request, res: Response) => {
  try {
    const set = await FlashcardSet.findOne({
      _id: req.params.flashcardId as string,
      createdBy: req.user!.id,
      isDeleted: { $ne: true },
    });
    if (!set) return sendError(res, "Flashcard set not found", 404);

    set.cards.push({
      cardId: nanoid(),
      front: req.body.front,
      back: req.body.back,
      tags: [],
      difficulty: "medium",
      reviewCount: 0,
      masteryLevel: 0,
    } as any);
    await set.save();

    const card = set.cards[set.cards.length - 1] as any;
    sendSuccess(
      res,
      "Flashcard added.",
      {
        id: card.cardId,
        front: card.front,
        back: card.back,
        createdAt: set.updatedAt || set.createdAt,
      },
      null,
      201,
    );
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to add flashcard",
      500,
    );
  }
};

export const updateFlashcardCard = async (req: Request, res: Response) => {
  try {
    const set = await FlashcardSet.findOne({
      _id: req.params.flashcardId as string,
      createdBy: req.user!.id,
      isDeleted: { $ne: true },
    });
    if (!set) return sendError(res, "Flashcard set not found", 404);

    const card = set.cards.find(
      (c: any) => c.cardId === (req.params.cardId as string),
    );
    if (!card) return sendError(res, "Flashcard not found", 404);

    card.front = req.body.front;
    card.back = req.body.back;
    await set.save();

    sendSuccess(res, "Flashcard updated.");
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to update flashcard",
      500,
    );
  }
};

export const deleteFlashcardCard = async (req: Request, res: Response) => {
  try {
    const set = await FlashcardSet.findOne({
      _id: req.params.flashcardId as string,
      createdBy: req.user!.id,
      isDeleted: { $ne: true },
    });
    if (!set) return sendError(res, "Flashcard set not found", 404);

    const nextCards = set.cards.filter(
      (c: any) => c.cardId !== (req.params.cardId as string),
    ) as any;
    if (nextCards.length === set.cards.length) {
      return sendError(res, "Flashcard not found", 404);
    }
    set.cards = nextCards;
    await set.save();

    sendSuccess(res, "Flashcard deleted.");
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to delete flashcard",
      500,
    );
  }
};

export const getQuizzes = async (req: Request, res: Response) => {
  try {
    const data = await PersonalQuiz.aggregate([
      {
        $match: {
          createdBy: new Types.ObjectId(req.user!.id),
          isDeleted: { $ne: true },
        },
      },
      {
        $lookup: {
          from: "courses",
          localField: "courseId",
          foreignField: "_id",
          as: "course",
        },
      },
      {
        $unwind: {
          path: "$course",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          _id: 0,
          id: { $toString: "$_id" },
          title: 1,
          courseTitle: "$course.title",
          courseCode: "$course.code",
          questionCount: {
            $sum: {
              $map: {
                input: { $ifNull: ["$lectures", []] },
                as: "lecture",
                in: {
                  $sum: {
                    $map: {
                      input: { $ifNull: ["$$lecture.topics", []] },
                      as: "topic",
                      in: {
                        $sum: {
                          $map: {
                            input: { $ifNull: ["$$topic.questionTypes", []] },
                            as: "group",
                            in: {
                              $size: { $ifNull: ["$$group.questions", []] },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          lectureCount: { $size: { $ifNull: ["$lectures", []] } },
          averageScore: "$stats.averageScore",
          totalAttempts: "$stats.totalAttempts",
          createdAt: 1,
        },
      },
      { $sort: { createdAt: -1 } },
    ]);

    sendSuccess(res, "Quizzes retrieved.", data);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to get quizzes",
      500,
    );
  }
};

export const getQuiz = async (req: Request, res: Response) => {
  try {
    const { quizId } = req.params;
    const data = await PersonalQuiz.aggregate([
      {
        $match: {
          _id: new Types.ObjectId(String(quizId)),
          createdBy: new Types.ObjectId(req.user!.id),
          isDeleted: { $ne: true },
        },
      },
      {
        $lookup: {
          from: "courses",
          localField: "courseId",
          foreignField: "_id",
          as: "course",
        },
      },
      { $unwind: { path: "$course", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "questions",
          let: {
            questionIds: {
              $reduce: {
                input: { $ifNull: ["$lectures", []] },
                initialValue: [],
                in: {
                  $concatArrays: [
                    "$$value",
                    {
                      $reduce: {
                        input: { $ifNull: ["$$this.topics", []] },
                        initialValue: [],
                        in: {
                          $concatArrays: [
                            "$$value",
                            {
                              $reduce: {
                                input: {
                                  $ifNull: ["$$this.questionTypes", []],
                                },
                                initialValue: [],
                                in: {
                                  $concatArrays: [
                                    "$$value",
                                    { $ifNull: ["$$this.questions", []] },
                                  ],
                                },
                              },
                            },
                          ],
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
          pipeline: [
            {
              $match: {
                $expr: { $in: ["$_id", { $ifNull: ["$$questionIds", []] }] },
              },
            },
            {
              $project: {
                _id: 1,
                question: 1,
                type: 1,
                options: 1,
                hint: 1,
                explanation: 1,
                answer: 1,
              },
            },
          ],
          as: "questionDocs",
        },
      },
      {
        $project: {
          _id: 0,
          id: { $toString: "$_id" },
          title: 1,
          courseTitle: "$course.title",
          courseCode: "$course.code",
          lectures: {
            $map: {
              input: { $ifNull: ["$lectures", []] },
              as: "lecture",
              in: {
                lectureTitle: "$$lecture.title",
                topics: {
                  $map: {
                    input: { $ifNull: ["$$lecture.topics", []] },
                    as: "topic",
                    in: {
                      topicTitle: "$$topic.title",
                      questions: {
                        $reduce: {
                          input: { $ifNull: ["$$topic.questionTypes", []] },
                          initialValue: [],
                          in: {
                            $concatArrays: [
                              "$$value",
                              {
                                $map: {
                                  input: { $ifNull: ["$$this.questions", []] },
                                  as: "questionId",
                                  in: {
                                    $let: {
                                      vars: {
                                        qDoc: {
                                          $first: {
                                            $filter: {
                                              input: "$questionDocs",
                                              as: "qd",
                                              cond: {
                                                $eq: [
                                                  "$$qd._id",
                                                  "$$questionId",
                                                ],
                                              },
                                            },
                                          },
                                        },
                                      },
                                      in: {
                                        id: { $toString: "$$questionId" },
                                        question: {
                                          $ifNull: [
                                            "$$qDoc.question",
                                            "Question",
                                          ],
                                        },
                                        type: {
                                          $cond: [
                                            {
                                              $in: [
                                                {
                                                  $ifNull: [
                                                    "$$qDoc.type",
                                                    "$$this.type",
                                                  ],
                                                },
                                                ["mcq", "true-false"],
                                              ],
                                            },
                                            "mcq",
                                            "free_text",
                                          ],
                                        },
                                        options: "$$qDoc.options",
                                        hint: "$$qDoc.hint",
                                        explanation: "$$qDoc.explanation",
                                        correctAnswer: "$$qDoc.answer",
                                      },
                                    },
                                  },
                                },
                              },
                            ],
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          createdAt: 1,
        },
      },
      { $limit: 1 },
    ]);

    if (!data.length) return sendError(res, "Quiz not found", 404);

    sendSuccess(res, "Quiz retrieved.", data[0]);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to get quiz",
      500,
    );
  }
};

export const deleteQuiz = async (req: Request, res: Response) => {
  try {
    const deleted = await PersonalQuiz.findOneAndUpdate(
      {
        _id: req.params.quizId as string,
        createdBy: req.user!.id,
        isDeleted: { $ne: true },
      },
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!deleted) return sendError(res, "Quiz not found", 404);
    sendSuccess(res, "Quiz deleted.");
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to delete quiz",
      500,
    );
  }
};

export const gradeQuizAnswers = async (req: Request, res: Response) => {
  try {
    const { quizId } = req.params;
    const { answers } = req.body as {
      answers: {
        questionId: string;
        question: string;
        answer: string;
        correctAnswer?: string;
      }[];
    };

    const jobId = `grade_${quizId}_${req.user!.id}_${Date.now()}`;

    await longQueue.enqueue("ai:grade_quiz_answers", {
      quizId,
      userId: req.user!.id,
      answers,
      jobId,
    });

    emitEvent(
      "quiz:private_submitted",
      req.user!.id,
      { type: "personal_quiz", id: quizId as string },
      { questionCount: answers.length, jobId },
    );

    sendSuccess(res, "Grading queued.", { jobId }, null, 202);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to queue grading",
      500,
    );
  }
};

export const getGradeResult = async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const key = `quiz:grade:result:${jobId}`;
    const raw = await redisConnection.get(key);
    if (!raw) {
      return sendSuccess(res, "Pending.", { status: "pending" });
    }
    const result = JSON.parse(raw);
    return sendSuccess(res, "Graded.", { status: "complete", ...result });
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to fetch grade result",
      500,
    );
  }
};

export const getMindMaps = async (req: Request, res: Response) => {
  try {
    const data = await MindMap.aggregate([
      {
        $match: {
          userId: new Types.ObjectId(req.user!.id),
          isDeleted: { $ne: true },
        },
      },
      {
        $project: {
          _id: 0,
          id: { $toString: "$_id" },
          sessionId: { $ifNull: ["$sourceSessionId", ""] },
          sessionName: {
            $cond: [
              { $ifNull: ["$sourceSessionId", false] },
              {
                $concat: [
                  "Session ",
                  { $substrBytes: ["$sourceSessionId", 0, 8] },
                ],
              },
              "Standalone",
            ],
          },
          title: 1,
          nodeCount: { $size: { $ifNull: ["$nodes", []] } },
          edgeCount: { $size: { $ifNull: ["$edges", []] } },
          createdAt: 1,
          updatedAt: 1,
        },
      },
      { $sort: { updatedAt: -1 } },
    ]);

    sendSuccess(res, "Mind maps retrieved.", data);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to get mind maps",
      500,
    );
  }
};

export const getMindMap = async (req: Request, res: Response) => {
  try {
    const mindMap = await MindMap.findOne({
      _id: req.params.mindMapId as string,
      userId: req.user!.id,
      isDeleted: { $ne: true },
    }).lean();

    if (!mindMap) return sendError(res, "Mind map not found", 404);

    sendSuccess(res, "Mind map retrieved.", {
      id: String((mindMap as any)._id),
      title: (mindMap as any).title,
      sessionId: (mindMap as any).sourceSessionId,
      mindMap: {
        nodes: (mindMap as any).nodes || [],
        edges: (mindMap as any).edges || [],
        updatedAt: (mindMap as any).updatedAt,
      },
      createdAt: (mindMap as any).createdAt,
      updatedAt: (mindMap as any).updatedAt,
    });
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to get mind map",
      500,
    );
  }
};

export const deleteMindMap = async (req: Request, res: Response) => {
  try {
    const deleted = await MindMap.findOneAndUpdate(
      {
        _id: req.params.mindMapId as string,
        userId: req.user!.id,
        isDeleted: { $ne: true },
      },
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!deleted) return sendError(res, "Mind map not found", 404);
    sendSuccess(res, "Mind map deleted.");
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to delete mind map",
      500,
    );
  }
};

export const exportSessionMindMap = async (req: Request, res: Response) => {
  try {
    const session = await selectors.getSessionById(req.params.id as string);
    if (!session) return sendError(res, "Session not found", 404);
    if (!isOwnedByUser((session as any).userId, req.user!.id)) {
      return sendError(res, "Forbidden", 403);
    }

    const artifactId = req.body?.artifactId as string | undefined;
    const artifacts = (session as any).artifacts || [];
    const candidates = artifacts.filter((a: any) => a.type === "mindmap");
    const artifact = artifactId
      ? candidates.find((a: any) => a.artifactId === artifactId)
      : [...candidates].reverse()[0];

    if (!artifact) return sendError(res, "Mind map artifact not found", 404);

    const upserted = await MindMap.findOneAndUpdate(
      {
        userId: new Types.ObjectId(req.user!.id),
        sourceSessionId: String((session as any)._id),
        sourceArtifactId: artifact.artifactId,
      },
      {
        $set: {
          title: artifact.title || "Mind Map",
          nodes: artifact.content?.nodes || [],
          edges: artifact.content?.edges || [],
          sourceSessionId: String((session as any)._id),
          sourceArtifactId: artifact.artifactId,
          courseId: (session as any).courseId,
          isDeleted: false,
          deletedAt: null,
        },
      },
      { upsert: true, returnDocument: "after" },
    );

    sendSuccess(res, "Mind map exported to standalone library.", {
      id: String((upserted as any)._id),
    });
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to export mind map",
      500,
    );
  }
};

export const getNotes = async (req: Request, res: Response) => {
  try {
    const notes = await Note.aggregate([
      {
        $match: {
          userId: new Types.ObjectId(req.user!.id),
          isDeleted: { $ne: true },
        },
      },
      {
        $project: {
          _id: 0,
          id: { $toString: "$_id" },
          sessionId: 1,
          title: 1,
          contentPreview: "$content",
          generatedByZ: 1,
          sessionName: 1,
          courseTitle: 1,
          createdAt: 1,
        },
      },
      { $sort: { updatedAt: -1 } },
    ]);

    sendSuccess(res, "Notes retrieved.", notes);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to get notes",
      500,
    );
  }
};

export const getNote = async (req: Request, res: Response) => {
  try {
    const data = await Note.aggregate([
      {
        $match: {
          _id: new Types.ObjectId(String(req.params.noteId)),
          userId: new Types.ObjectId(req.user!.id),
          isDeleted: { $ne: true },
        },
      },
      {
        $project: {
          _id: 0,
          id: { $toString: "$_id" },
          sessionId: 1,
          sourceNoteId: 1,
          title: 1,
          content: 1,
          generatedByZ: 1,
          sessionName: 1,
          courseTitle: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      { $limit: 1 },
    ]);

    if (!data.length) return sendError(res, "Note not found", 404);
    sendSuccess(res, "Note retrieved.", data[0]);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to get note",
      500,
    );
  }
};

export const deleteNote = async (req: Request, res: Response) => {
  try {
    const deleted = await Note.findOneAndUpdate(
      {
        _id: req.params.noteId as string,
        userId: req.user!.id,
        sessionId: req.params.sessionId as string,
        isDeleted: { $ne: true },
      },
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!deleted) return sendError(res, "Note not found", 404);
    sendSuccess(res, "Note deleted.");
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to delete note",
      500,
    );
  }
};

// ─── MATERIAL & AI GENERATION CONTROLLERS ────────────────────────────────────

export const createMaterial = async (req: Request, res: Response) => {
  try {
    if (!(await consumeUsageOnSuccess(req, res, "materialUploads"))) return;
    const material = await services.createMaterial(req.user!.id, req.body);

    // Queue processing job at controller level
    await longQueue.enqueue("material:process", {
      materialId: material._id.toString(),
      userId: req.user!.id,
    });

    emitEvent(
      "material:uploaded",
      req.user!.id,
      { type: "material", id: material._id },
      { type: (material as any).type },
    );

    sendSuccess(
      res,
      "Material uploaded and queued for processing.",
      AppSerializers.materialSerializer(material as any),
      null,
      201,
    );
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to create material",
      500,
    );
  }
};

export const getMaterials = async (req: Request, res: Response) => {
  try {
    const materials = await learningSelectors.getMaterialsByUser(req.user!.id, req.query);

    // Fetch library status for these materials to show contribution flag
    const materialIds = (materials as any[]).map((m) => m._id);
    const libraryItems = await LibraryMaterial.find({
      materialId: { $in: materialIds },
    })
      .select("materialId status")
      .lean();

    const statusMap = libraryItems.reduce(
      (acc, item) => {
        acc[item.materialId.toString()] = item.status;
        return acc;
      },
      {} as Record<string, string>,
    );

    const enriched = (materials as any[]).map((m) => ({
      ...AppSerializers.materialSerializer(m),
      libraryStatus: statusMap[m._id.toString()] || null,
    }));

    sendSuccess(res, "Materials retrieved.", enriched);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to get materials",
      500,
    );
  }
};

export const deleteMaterial = async (req: Request, res: Response) => {
  try {
    await services.deleteMaterial(req.params.id as string, req.user!.id);
    sendSuccess(res, "Material deleted.");
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to delete material",
      500,
    );
  }
};

export const downloadMaterial = async (req: Request, res: Response) => {
  try {
    const { id: sessionId, materialId } = req.params;

    const material = await Material.findById(materialId).populate("upload");
    if (!material) return sendError(res, "Material not found", 404);

    const session = await StudySession.findById(sessionId);
    if (!session) return sendError(res, "Session not found", 404);

    const isOwner = isOwnedByUser(session.userId, req.user!.id);
    const isPeer = session.peers?.some(
      (p: any) => p.id.toString() === req.user!.id,
    );
    if (!isOwner && !isPeer) return sendError(res, "Forbidden", 403);

    const upload = material.upload as any;
    if (!upload?.url) return sendError(res, "Upload not found", 404);

    return upload.url.startsWith("http")
      ? res.redirect(upload.url)
      : res.sendFile(upload.url);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to download material",
      500,
    );
  }
};

export const processMaterial = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const material = await Material.findOne({
      _id: id,
      uploadedBy: req.user!.id,
    });
    if (!material) return sendError(res, "Material not found", 404);

    if (material.processingStatus === "ready") {
      return sendError(res, "Material is already processed.", 400);
    }

    // Reset processing status
    material.processingStatus = "processing";
    material.failureReason = undefined;
    await material.save();

    // Enqueue the material:process job natively
    await longQueue.enqueue("material:process", {
      materialId: material._id.toString(),
      userId: req.user!.id,
    });

    sendSuccess(res, "Material processing started.", null, null, 202);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to process material",
      500,
    );
  }
};

export const generateFlashcards = async (req: Request, res: Response) => {
  try {
    const { materialId, courseId } = req.body;
    if (!(await consumeUsageOnSuccess(req, res, "flashcardSets"))) return;

    // Queue job at controller level
    await longQueue.enqueue("ai:generate_flashcards", {
      materialId,
      courseId,
      createdBy: req.user!.id,
    });
    sendSuccess(res, "Flashcard generation job queued.", null, null, 202);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to generate flashcards",
      500,
    );
  }
};

export const generatePersonalQuiz = async (req: Request, res: Response) => {
  try {
    const { materialId, courseId, settings } = req.body;
    if (!(await consumeUsageOnSuccess(req, res, "quizGenerations"))) return;

    // Queue job at controller level
    await longQueue.enqueue("ai:generate_personal_quiz", {
      materialId,
      courseId,
      createdBy: req.user!.id,
      settings,
    });
    sendSuccess(res, "Quiz generation job queued.", null, null, 202);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to generate quiz",
      500,
    );
  }
};

export const generateMindMap = async (req: Request, res: Response) => {
  try {
    const { materialId, courseId, settings } = req.body;
    if (!(await consumeUsageOnSuccess(req, res, "mindMaps"))) return;

    // Queue job at controller level
    await longQueue.enqueue("ai:generate_mindmap", {
      materialId,
      courseId,
      createdBy: req.user!.id,
      settings,
    });
    sendSuccess(res, "Mind Map generation job queued.", null, null, 202);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to generate mind map",
      500,
    );
  }
};

// ─── STUDIO CONTROLLERS ──────────────────────────────────────────────────────

export const createStudioNote = async (req: Request, res: Response) => {
  try {
    const { id: sessionId } = req.params;
    const { title, content } = req.body;

    const session = await StudySession.findById(sessionId);
    if (!session) return sendError(res, "Session not found", 404);

    const note = new Note({
      userId: req.user!.id,
      sessionId,
      sourceNoteId: nanoid(),
      title: title || "New Note",
      content,
      generatedByZ: false,
      sessionName: (session as any).name,
      courseTitle: (session as any).courseTitle,
    });

    await note.save();

    emitEvent(
      "note:saved",
      req.user!.id,
      { type: "note", id: note._id },
      { sessionId, title: note.title },
    );

    sendSuccess(res, "Note created.", note, null, 201);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to create studio note",
      500,
    );
  }
};

export const updateStudioNote = async (req: Request, res: Response) => {
  try {
    const noteId = req.params.noteId as string;
    const { content, title } = req.body;

    const note = await Note.findOneAndUpdate(
      { _id: noteId, userId: req.user!.id },
      { $set: { content, title, updatedAt: new Date() } },
      { returnDocument: "after" },
    );

    if (!note) return sendError(res, "Note not found", 404);
    sendSuccess(res, "Note updated.", note);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to update studio note",
      500,
    );
  }
};

export const deleteStudioNote = async (req: Request, res: Response) => {
  try {
    const noteId = req.params.noteId as string;
    const deleted = await Note.findOneAndUpdate(
      { _id: noteId, userId: req.user!.id },
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!deleted) return sendError(res, "Note not found", 404);
    sendSuccess(res, "Note deleted.");
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to delete studio note",
      500,
    );
  }
};

export const createStudioSharedNote = async (req: Request, res: Response) => {
  try {
    const { id: sessionId } = req.params;
    const { content } = req.body;

    // For now, shared notes are just pushed into the session's artifacts/shared pool
    // In a real implementation, you might have a SharedNote model
    const user = await User.findById(req.user!.id).select("name");
    const session = await StudySession.findByIdAndUpdate(
      sessionId,
      {
        $push: {
          sharedNotes: {
            id: nanoid(),
            content,
            authorId: req.user!.id,
            authorName: user?.name || "User",
            createdAt: new Date(),
          },
        },
      },
      { returnDocument: "after" },
    );

    if (!session) return sendError(res, "Session not found", 404);
    const created = (session as any).sharedNotes.slice(-1)[0];
    sendSuccess(res, "Shared note created.", created, null, 201);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to create shared note",
      500,
    );
  }
};

export const saveStudioFlashcards = async (req: Request, res: Response) => {
  try {
    const { id: sessionId } = req.params;
    const { title } = req.body;

    const session = await StudySession.findById(sessionId);
    if (!session) return sendError(res, "Session not found", 404);

    // Get the flashcards from the session's latest flashcard artifact
    const artifacts = (session as any).artifacts || [];
    const flashcardArtifact = [...artifacts]
      .reverse()
      .find((a: any) => a.type === "flashcards");

    if (!flashcardArtifact) {
      return sendError(res, "No generated flashcards found in session", 404);
    }

    const artifactId = String(flashcardArtifact.artifactId || "");
    if (!artifactId) {
      return sendError(
        res,
        "Generated flashcards are missing artifact id",
        400,
      );
    }

    const lockResult = await StudySession.updateOne(
      {
        _id: sessionId,
        "studio.savedFlashcardArtifactIds": { $ne: artifactId },
      },
      { $addToSet: { "studio.savedFlashcardArtifactIds": artifactId } },
    );
    if (lockResult.modifiedCount === 0) {
      return sendError(
        res,
        "This flashcard artifact has already been saved",
        409,
      );
    }

    if (!(await consumeUsageOnSuccess(req, res, "flashcardSets"))) return;

    const cards = flashcardArtifact.content || [];
    const flashcardSet = new FlashcardSet({
      title: title || flashcardArtifact.title || "Generated Set",
      createdBy: req.user!.id,
      courseId: (session as any).courseId,
      cards: cards.map((c: any) => ({
        cardId: nanoid(),
        front: c.front,
        back: c.back,
      })),
    });

    await flashcardSet.save();
    sendSuccess(res, "Flashcards saved to library.", flashcardSet, null, 201);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to save flashcards",
      500,
    );
  }
};

export const saveStudioQuiz = async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id as string;
    const quizId = req.params.quizId as string;

    const session = await StudySession.findById(sessionId);
    if (!session) return sendError(res, "Session not found", 404);

    const artifacts = (session as any).artifacts || [];
    const quizArtifact = artifacts.find((a: any) => a.artifactId === quizId);

    if (!quizArtifact) {
      return sendError(res, "Quiz artifact not found in session", 404);
    }

    const lockResult = await StudySession.updateOne(
      { _id: sessionId, "studio.savedQuizArtifactIds": { $ne: quizId } },
      { $addToSet: { "studio.savedQuizArtifactIds": quizId } },
    );
    if (lockResult.modifiedCount === 0) {
      return sendError(res, "This quiz artifact has already been saved", 409);
    }

    if (!(await consumeUsageOnSuccess(req, res, "quizGenerations"))) return;

    // Transfer artifact to PersonalQuiz
    const personalQuiz = new PersonalQuiz({
      title: quizArtifact.title || "Generated Quiz",
      createdBy: req.user!.id,
      courseId: (session as any).courseId,
      lectures: quizArtifact.content?.lectures || [],
    });

    await personalQuiz.save();

    emitEvent(
      "quiz:private_created",
      req.user!.id,
      { type: "personal_quiz", id: personalQuiz._id },
      { title: personalQuiz.title, source: "studio_artifact" },
    );

    sendSuccess(res, "Quiz saved to bank.", personalQuiz, null, 201);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to save quiz",
      500,
    );
  }
};

export const createStudioExport = async (req: Request, res: Response) => {
  try {
    const { id: sessionId } = req.params;
    const { type } = req.body; // 'pdf' or 'markdown'

    if (type === "pdf") {
      const role = (req as any).user?.role;
      if (role !== "super_admin") {
        const userId = (req as any).user?.id;
        const userDoc = await User.findById(userId).select("planTier").lean();
        const planTier = userDoc?.planTier as string | null | undefined;
        if (!planTier || !["cruising", "locked_in"].includes(planTier)) {
          return sendError(
            res,
            "PDF export requires Cruising or Locked In plan",
            403,
          );
        }
      }
    }

    const session = await StudySession.findById(sessionId);
    if (!session) return sendError(res, "Session not found", 404);

    // Generate a placeholder export artifact
    const exportData = {
      id: nanoid(),
      type,
      url: `/api/v1/app/${sessionId}/studio/exports/${nanoid()}.${type === "pdf" ? "pdf" : "md"}`,
      createdAt: new Date().toISOString(),
    };

    await StudySession.findByIdAndUpdate(sessionId, {
      $push: { exports: exportData },
    });

    sendSuccess(res, "Export generated.", exportData, null, 201);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to generate export",
      500,
    );
  }
};

export const updateStudioMindMap = async (req: Request, res: Response) => {
  try {
    const { id: sessionId } = req.params;
    const { mindMap } = req.body;

    const session = await StudySession.findByIdAndUpdate(
      sessionId,
      {
        $set: { "studio.mindMap": mindMap },
      },
      { returnDocument: "after" },
    );

    if (!session) return sendError(res, "Session not found", 404);
    sendSuccess(res, "Mindmap updated.", (session as any).studio.mindMap);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to update mindmap",
      500,
    );
  }
};

export const rateMessage = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const sessionId = String(req.params.sessionId);
    const messageId = String(req.params.messageId);
    const { rating } = req.body;
    const userId = (req as any).user?.id;
    if (!userId) {
      sendError(res, "Unauthorized", 401);
      return;
    }
    if (rating !== 1 && rating !== -1) {
      sendError(res, "Rating must be 1 or -1", 400);
      return;
    }
    await services.rateMessage(sessionId, messageId, userId, rating);
    sendSuccess(res, "Message rated", { rated: true });
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to rate message",
      400,
    );
  }
};

export const getAnalytics = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    const role = (req as any).user?.role;
    const isSuperAdmin = role === "super_admin";

    if (!isSuperAdmin) {
      const userDoc = await User.findById(userId).select("planTier").lean();
      const planTier = userDoc?.planTier;
      if (
        !planTier ||
        !["cruising", "locked_in"].includes(planTier as string)
      ) {
        sendError(res, "Analytics requires Cruising or Locked In plan", 403);
        return;
      }
    }

    const summary = await services.getAnalyticsSummary(userId);
    sendSuccess(res, "Analytics summary", summary);
  } catch {
    sendError(res, "Failed to fetch analytics", 500);
  }
};

export const continueJourney = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const sessionId = String(req.params.id);
    const userId = (req as any).user?.id;
    const { chapterId, stepId, blockId, chapterNumber, topicTitle } = req.body;

    const result = await services.continueJourney(sessionId, userId, {
      chapterId,
      stepId,
      blockId,
      chapterNumber,
      topicTitle,
    });

    // Enqueue background trigger to launch Z into the active topic without any user message!
    await longQueue.enqueue(
      "app:session:trigger",
      {
        sessionId,
        userId,
        trigger: "journey_step",
        payload: {
          chapterId: result.chapter?.chapterId || chapterId,
          chapterTitle: result.chapter?.title,
          stepId: result.step?.stepId || stepId,
          stepTitle: result.step?.title || topicTitle,
          coreIdea: result.step?.coreIdea,
          whyItMatters: result.step?.whyItMatters,
          activeBlockTitle: result.block?.title,
        },
      },
      3,
      `journey_${sessionId}_${Date.now()}`,
    );

    sendSuccess(res, "Journey position updated", result);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to update journey position",
      400,
    );
  }
};

export const respondToDirectiveArtifact = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const sessionId = String(req.params.id);
    const artifactId = String(req.params.artifactId);
    const userId = (req as any).user?.id;
    const { response } = req.body;

    const result = await services.respondToDirectiveArtifact(
      sessionId,
      artifactId,
      response || req.body,
      userId,
    );
    sendSuccess(res, "Directive response recorded", result);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to record directive response",
      400,
    );
  }
};

export const toggleBlockCompletion = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const sessionId = String(req.params.id);
    const blockId = String(req.params.blockId);
    const userId = (req as any).user?.id;

    const result = await services.toggleBlockCompletion(
      sessionId,
      blockId,
      userId,
    );
    sendSuccess(res, "Block completion toggled", result);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to toggle block",
      400,
    );
  }
};

export const addChapter = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const sessionId = String(req.params.id);
    const { title, description } = req.body;

    const result = await services.addChapter(sessionId, { title, description });
    sendSuccess(res, "Chapter added", result, null, 201);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to add chapter",
      400,
    );
  }
};

export const updateChapter = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const sessionId = String(req.params.id);
    const chapterId = String(req.params.chapterId);

    const result = await services.updateChapter(sessionId, chapterId, req.body);
    sendSuccess(res, "Chapter updated", result);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to update chapter",
      400,
    );
  }
};

export const addChapterGoal = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const sessionId = String(req.params.id);
    const chapterId = String(req.params.chapterId);
    const { title, description } = req.body;

    const result = await services.addChapterGoal(sessionId, chapterId, {
      title,
      description,
    });
    sendSuccess(res, "Chapter goal added", result, null, 201);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to add chapter goal",
      400,
    );
  }
};

export const updateChapterGoal = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const sessionId = String(req.params.id);
    const chapterId = String(req.params.chapterId);
    const goalId = String(req.params.goalId);

    const result = await services.updateChapterGoal(
      sessionId,
      chapterId,
      goalId,
      req.body,
    );
    sendSuccess(res, "Chapter goal updated", result);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to update chapter goal",
      400,
    );
  }
};

export const deleteChapterGoal = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const sessionId = String(req.params.id);
    const chapterId = String(req.params.chapterId);
    const goalId = String(req.params.goalId);

    const result = await services.deleteChapterGoal(
      sessionId,
      chapterId,
      goalId,
    );
    sendSuccess(res, "Chapter goal deleted", result);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to delete chapter goal",
      400,
    );
  }
};

export const generateStudyPlan = async (
  req: Request,
  res: Response,
) => {
  try {
    const sessionId = String(req.params.id);
    const userId = String(req.user!.id);
    const { goal, instruction, userRequest } = req.body || {};

    const session = await StudySession.findById(sessionId);
    if (!session) return sendError(res, "Session not found", 404);

    if (!session.materialIds || session.materialIds.length === 0) {
      return sendError(
        res,
        "No materials found in session. Please add study materials before generating a study plan.",
        400,
      );
    }

    const existingPlan = await StudyPlan.findOne({
      sessionId: new Types.ObjectId(sessionId),
    });

    const isUpdate = Boolean(existingPlan);
    const userInstruction = instruction || userRequest || goal;
    const jobName = isUpdate ? "ai:update_study_plan" : "ai:generate_study_plan";

    await longQueue.enqueue(jobName, {
      sessionId,
      userId,
      goal: goal || existingPlan?.goal,
      instruction: userInstruction,
      materialIds: (session.materialIds || []).map(String),
      courseId: session.courseId ? String(session.courseId) : undefined,
    });

    sendSuccess(
      res,
      isUpdate
        ? "Study plan update job queued successfully"
        : "Study plan generation job queued successfully",
    );
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error
        ? err.message
        : "Failed to queue study plan generation",
      400,
    );
  }
};

export const generateCourseSummary = async (
  req: Request,
  res: Response,
) => {
  try {
    const sessionId = String(req.params.id);
    const userId = String(req.user!.id);

    const session = await StudySession.findById(sessionId);
    if (!session) return sendError(res, "Session not found", 404);

    if (!session.materialIds || session.materialIds.length === 0) {
      return sendError(
        res,
        "No materials found in session. Please add study materials before generating a course summary.",
        400,
      );
    }

    await longQueue.enqueue("ai:generate_course_summary", {
      sessionId,
      userId,
      materialIds: (session.materialIds || []).map(String),
      courseId: session.courseId ? String(session.courseId) : undefined,
    });

    sendSuccess(res, "Course summary generation job queued successfully");
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to queue course summary generation",
      400,
    );
  }
};

// ─── TASK CONTROLLERS ───────────────────────────────────────────────────

export const createTask = async (req: Request, res: Response) => {
  try {
    const task = await services.createTask(req.user!.id, req.body);
    sendSuccess(res, "Study task created.", AppSerializers.task(task), null, 201);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to create study task",
      500,
    );
  }
};

/**
 * GET /app/tasks — computes progress via aggregation rather than a
 * separate count query. `metadata.{completed,total,progress}` reflects
 * every non-deleted task for the user regardless of the `?status=` filter
 * (matching the UI's overall "2/8 done" summary staying stable across the
 * All/Active/Completed tabs) — only the `tasks` array itself is filtered.
 * Sorted active-before-completed (then newest first within each group),
 * per the "sorted based on active status" requirement.
 */
export const listTasks = async (req: Request, res: Response) => {
  try {
    const status = req.query.status as "active" | "completed" | undefined;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.max(1, Number(req.query.limit) || 10);

    const [result] = await Task.aggregate([
      {
        $match: {
          userId: new Types.ObjectId(req.user!.id),
          isDeleted: { $ne: true },
        },
      },
      {
        $facet: {
          tasks: [
            ...(status ? [{ $match: { status } }] : []),
            {
              $addFields: {
                statusOrder: { $cond: [{ $eq: ["$status", "active"] }, 0, 1] },
              },
            },
            { $sort: { statusOrder: 1, createdAt: -1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
              $project: {
                _id: 0,
                id: { $toString: "$_id" },
                title: 1,
                subject: 1,
                status: 1,
                completedAt: 1,
                createdAt: 1,
                updatedAt: 1,
              },
            },
          ],
          counts: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                completed: {
                  $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
                },
              },
            },
          ],
        },
      },
    ]);

    const total = result?.counts?.[0]?.total ?? 0;
    const completed = result?.counts?.[0]?.completed ?? 0;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    sendSuccess(res, "Tasks retrieved.", {
      tasks: result?.tasks ?? [],
      metadata: { completed, total, progress },
    });
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to get tasks",
      500,
    );
  }
};

export const updateTask = async (req: Request, res: Response) => {
  try {
    const task = await services.updateTask(
      req.user!.id,
      req.params.id as string,
      req.body,
    );
    if (!task) return sendError(res, "Task not found", 404);
    sendSuccess(res, "Task updated.", AppSerializers.task(task));
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to update task",
      500,
    );
  }
};

export const deleteTask = async (req: Request, res: Response) => {
  try {
    const deleted = await services.deleteTask(
      req.user!.id,
      req.params.id as string,
    );
    if (!deleted) return sendError(res, "Task not found", 404);
    sendSuccess(res, "Task deleted.");
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to delete task",
      500,
    );
  }
};



