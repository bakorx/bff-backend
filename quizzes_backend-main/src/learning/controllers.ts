import { Request, Response } from "express";
import { Types, isValidObjectId } from "mongoose";
import * as services from "./services";
import * as selectors from "./selectors";
import {
  sendSuccess,
  sendError,
  getPaginatedMetadata,
  applySearchFilters,
  IPaginationOptions,
} from "@/utils";
import { longQueue } from "@/schedulers";
import { normalizeQuiz } from "./utils";
import { LibraryMaterial, Material, Quiz, Course } from "./models";
import { Upload } from "@/system";
import { User } from "@/users";
import axios from "axios";
import { consumeUsage, CREDIT_COSTS, FeatureKey } from "@/subscriptions";
import { logger } from "@/config";
import { emit as emitEvent } from "@/events/services";
import { rememberCrowdsourcedStudentId } from "./utils";

// --- LEARNING DOMAIN CONTROLLERS ---

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

export const createFlashcard = async (req: Request, res: Response) => {
  try {
    if (!(await consumeUsageOnSuccess(req, res, "flashcardSets"))) return;
    const flashcard = await services.createFlashcard(req.body);
    sendSuccess(res, "Flashcard created successfully", flashcard, null, 201);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getCourseFlashcards = async (req: Request, res: Response) => {
  try {
    const flashcards = await selectors.getFlashcardsByCourse(
      req.params.courseId as string,
      req.query,
    );
    sendSuccess(res, "Course flashcards retrieved successfully", flashcards);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const createMaterial = async (req: Request, res: Response) => {
  try {
    if (!(await consumeUsageOnSuccess(req, res, "materialUploads"))) return;
    const material = await services.createMaterial(req.body);

    // Creator-library path — never enqueues material:process, so this
    // upload will never get a matching material:processing_started/
    // completed pair (known gap, pre-existing, unrelated to event wiring).
    emitEvent(
      "material:uploaded",
      String(material.uploadedBy),
      { type: "material", id: material._id },
      { type: (material as any).type },
    );

    sendSuccess(res, "Material uploaded successfully", material, null, 201);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getCourseMaterials = async (req: Request, res: Response) => {
  try {
    const courseId = req.params.courseId as string;
    const userId = (req as any).user?.id;

    if (isValidObjectId(courseId)) {
      const course = await selectors.getCourseById(courseId);
      if (course?.isCustom && String(course.createdBy) !== userId) {
        return sendError(
          res,
          "Unauthorized to view materials for this custom course",
          403,
        );
      }
    }

    const materials = await selectors.getMaterialsByCourse(
      courseId,
      req.query,
    );

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

    const enrichedMaterials = (materials as any[]).map((m) => ({
      ...m,
      libraryStatus: statusMap[m._id.toString()] || null,
    }));

    sendSuccess(
      res,
      "Course materials retrieved successfully",
      enrichedMaterials,
    );
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getAllMaterials = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const customCoursesOther = await Course.find({
      isCustom: true,
      ...(userId ? { createdBy: { $ne: new Types.ObjectId(userId) } } : {}),
    })
      .select("_id")
      .lean();

    const excludedCourseIds = customCoursesOther.map((c: any) => c._id);
    const filter =
      excludedCourseIds.length > 0
        ? { courseId: { $nin: excludedCourseIds } }
        : {};

    const materials = await applySearchFilters(
      Material.find(filter).lean(),
      req.query,
    );

    // Fetch library status
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
      ...m,
      libraryStatus: statusMap[m._id.toString()] || null,
    }));

    sendSuccess(res, "All materials retrieved successfully", enriched);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getMaterial = async (req: Request, res: Response) => {
  try {
    const material = await selectors.getMaterialById(req.params.id as string);
    if (!material) return sendError(res, "Material not found", 404);
    sendSuccess(res, "Material retrieved successfully", material);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const createQuestion = async (req: Request, res: Response) => {
  try {
    const question = await services.createQuestion(req.body);
    sendSuccess(res, "Question added successfully", question, null, 201);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getCourseQuestions = async (req: Request, res: Response) => {
  try {
    const questions = await selectors.getQuestionsByCourse(
      req.params.courseId as string,
      req.query,
    );
    sendSuccess(res, "Course questions retrieved successfully", questions);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getAllQuestions = async (req: Request, res: Response) => {
  try {
    const questions = await selectors.getAllQuestions(req.query);
    sendSuccess(res, "All questions retrieved successfully", questions);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getQuestion = async (req: Request, res: Response) => {
  try {
    const question = await selectors.getQuestionById(req.params.id as string);
    if (!question) return sendError(res, "Question not found", 404);
    sendSuccess(res, "Question retrieved successfully", question);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getAllFlashcards = async (req: Request, res: Response) => {
  try {
    const flashcards = await selectors.getAllFlashcards(req.query);
    sendSuccess(res, "All flashcards retrieved successfully", flashcards);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getFlashcard = async (req: Request, res: Response) => {
  try {
    const flashcard = await selectors.getFlashcardById(req.params.id as string);
    if (!flashcard) return sendError(res, "Flashcard not found", 404);
    sendSuccess(res, "Flashcard retrieved successfully", flashcard);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const createPersonalQuiz = async (req: Request, res: Response) => {
  try {
    if (!(await consumeUsageOnSuccess(req, res, "quizGenerations"))) return;
    const quiz = await services.createPersonalQuiz(req.body);

    // req.user!.id, not quiz.createdBy — createdBy is client-supplied in
    // the request body (PersonalQuizSerializer) and isn't forced to match
    // the authenticated user.
    emitEvent(
      "quiz:private_created",
      req.user!.id,
      { type: "personal_quiz", id: quiz._id },
      { title: quiz.title },
    );

    sendSuccess(res, "Personal quiz generated successfully", quiz, null, 201);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getAllPersonalQuizzes = async (req: Request, res: Response) => {
  try {
    const quizzes = await selectors.getAllPersonalQuizzes(req.query);
    sendSuccess(res, "All personal quizzes retrieved successfully", quizzes);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getPersonalQuiz = async (req: Request, res: Response) => {
  try {
    const quiz = await selectors.getPersonalQuizById(req.params.id as string);
    if (!quiz) return sendError(res, "Quiz not found", 404);
    sendSuccess(res, "Quiz retrieved successfully", normalizeQuiz(quiz));
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

// --- COURSE CONTROLLERS ---

export const createCourse = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const body = {
      ...req.body,
      ...(userId && !req.body.createdBy ? { createdBy: userId } : {}),
    };
    const course = await services.createCourse(body);
    sendSuccess(res, "Course created successfully", course, null, 201);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const updateCourse = async (req: Request, res: Response) => {
  try {
    const course = await services.updateCourse(
      req.params.id as string,
      req.body,
    );
    if (!course) return sendError(res, "Course not found", 404);
    sendSuccess(res, "Course updated successfully", course);
  } catch (error: any) {
    if (error.code === 11000)
      return sendError(res, "A course with that code already exists", 409);
    sendError(res, error.message, 500);
  }
};

export const getCourse = async (req: Request, res: Response) => {
  try {
    const course = await selectors.getCourseById(req.params.id as string);
    if (!course) return sendError(res, "Course not found", 404);
    sendSuccess(res, "Course retrieved successfully", course);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getAllCourses = async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    const userId = (req as any).user?.id;
    const countFilter: Record<string, any> = {};
    if (userId) {
      countFilter.$or = [
        { isCustom: { $ne: true } },
        { createdBy: new Types.ObjectId(userId), isCustom: true },
      ];
    } else {
      countFilter.isCustom = { $ne: true };
    }
    if (search) {
      const re = new RegExp(
        String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
      countFilter.$and = [{ $or: [{ code: re }, { title: re }, { about: re }] }];
    }
    const options = { ...req.query, searchFields: ["code", "title", "about"] };
    const [courses, total] = await Promise.all([
      selectors.getAllCourses(options, userId),
      selectors.countAllCourses(countFilter),
    ]);
    const pagination = getPaginatedMetadata(total, Number(page), Number(limit));
    sendSuccess(res, "All courses retrieved successfully", courses, pagination);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getCourses = async (req: Request, res: Response) => {
  try {
    const { search, page, limit, sortBy, sortOrder } = req.query;
    const userId = (req as any).user?.id;

    // Explicitly define options to avoid passing 'searchFields[]' as a filter to MongoDB
    const options: IPaginationOptions = {
      search: search as string,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 10,
      sortBy: sortBy as string,
      sortOrder: sortOrder as "asc" | "desc",
      searchFields: ["code", "title"], // Force search on these fields
    };

    const countFilter: Record<string, any> = { isDeleted: false };
    if (userId) {
      countFilter.$or = [
        { isCustom: { $ne: true } },
        { createdBy: new Types.ObjectId(userId), isCustom: true },
      ];
    } else {
      countFilter.isCustom = { $ne: true };
    }

    const [courses, total] = await Promise.all([
      selectors.getActiveCourses(options, userId),
      selectors.countAllCourses(countFilter),
    ]);

    const pagination = getPaginatedMetadata(
      total,
      options.page!,
      options.limit!,
    );

    sendSuccess(res, "Courses retrieved successfully", courses, pagination);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

// --- SYSTEM QUIZ CONTROLLERS (PUBLIC) ---

export const getQuizzes = async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 12, search, tags } = req.query;
    const pageNum = Number(page);
    const limitNum = Number(limit);

    const matchFilter: Record<string, any> = {
      status: "published",
      isAvailable: true,
    };
    if (search) {
      const re = new RegExp(
        String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
      matchFilter.$or = [{ title: re }, { description: re }];
    }
    if (tags) matchFilter.tags = String(tags);

    const [result] = await Quiz.aggregate([
      { $match: matchFilter },
      {
        $facet: {
          data: [
            { $sort: { createdAt: -1 } },
            { $skip: (pageNum - 1) * limitNum },
            { $limit: limitNum },
            {
              $project: {
                title: 1,
                description: 1,
                courseId: 1,
                status: 1,
                isAvailable: 1,
                passingScore: 1,
                tags: 1,
                createdAt: 1,
                updatedAt: 1,
                lectureCount: { $size: { $ifNull: ["$lectures", []] } },
                questionCount: {
                  $sum: {
                    $map: {
                      input: { $ifNull: ["$lectures", []] },
                      as: "lec",
                      in: {
                        $sum: {
                          $map: {
                            input: { $ifNull: ["$$lec.topics", []] },
                            as: "top",
                            in: {
                              $sum: {
                                $map: {
                                  input: {
                                    $ifNull: ["$$top.questionTypes", []],
                                  },
                                  as: "grp",
                                  in: {
                                    $size: { $ifNull: ["$$grp.questions", []] },
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
              },
            },
          ],
          total: [{ $count: "count" }],
        },
      },
    ]);

    const quizzes = result?.data ?? [];
    const total = result?.total?.[0]?.count ?? 0;
    const pagination = getPaginatedMetadata(total, pageNum, limitNum);
    sendSuccess(res, "Quizzes retrieved successfully", quizzes, pagination);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getQuiz = async (req: Request, res: Response) => {
  try {
    const quiz = await selectors.getPublishedQuizMetadataById(
      req.params.id as string,
    );
    if (!quiz) return sendError(res, "Quiz not found", 404);

    let remainingAttempts: number | null = null;
    let nextAttemptAt: Date | null = null;
    if (req.user?.id) {
      const user = await User.findById(req.user.id).select("planTier").lean();
      const result = await services.getRemainingAttempts(
        req.user.id,
        user?.planTier ?? null,
      );
      remainingAttempts = result.remaining;
      nextAttemptAt = result.nextAttemptAt;
    }

    sendSuccess(res, "Quiz retrieved successfully", {
      ...normalizeQuiz(quiz, { stripQuestions: true }),
      remainingAttempts,
      nextAttemptAt,
    });
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const startQuizAttempt = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = await User.findById(req.user!.id)
      .select("planTier role")
      .lean();

    const STAFF_ROLES = ["super_admin", "creator", "moderator"];
    if (!STAFF_ROLES.includes(user?.role ?? "")) {
      await services.checkAndStartAttempt(
        req.user!.id,
        String(id),
        user?.planTier ?? null,
      );
    }

    const quiz = await selectors.getPublishedQuizById(String(id));
    if (!quiz) return sendError(res, "Quiz not found", 404);

    sendSuccess(res, "Quiz started.", normalizeQuiz(quiz));
  } catch (err: unknown) {
    const typedErr = err as Error & {
      statusCode?: number;
      nextAttemptAt?: Date;
    };
    if (typedErr.statusCode === 403) {
      return sendError(res, typedErr.message ?? "Attempt limit reached", 403, {
        nextAttemptAt: typedErr.nextAttemptAt ?? null,
      });
    }
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to start quiz",
      500,
    );
  }
};

export const confirmQuizAttempt = async (req: Request, res: Response) => {
  try {
    await services.confirmAttempt(req.user!.id, String(req.params.id));
    sendSuccess(res, "Attempt confirmed.", null);
  } catch (err: unknown) {
    sendError(
      res,
      err instanceof Error ? err.message : "Failed to confirm attempt",
      500,
    );
  }
};

// --- SYSTEM QUIZ CONTROLLERS (ADMIN) ---

export const adminGetQuizzes = async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 10, search, status } = req.query;
    const countFilter: Record<string, any> = {};
    if (status) countFilter.status = status;
    if (search) {
      const re = new RegExp(
        String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
      countFilter.$or = [{ title: re }];
    }
    const options = { ...req.query, searchFields: ["title"] };
    const [quizzes, total] = await Promise.all([
      selectors.getAllQuizzes(options),
      selectors.countAllQuizzes(countFilter),
    ]);
    const pagination = getPaginatedMetadata(total, Number(page), Number(limit));
    sendSuccess(res, "All quizzes retrieved successfully", quizzes, pagination);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const adminGetQuiz = async (req: Request, res: Response) => {
  try {
    const quiz = await selectors.getQuizById(req.params.id as string);
    if (!quiz) return sendError(res, "Quiz not found", 404);
    sendSuccess(res, "Quiz retrieved successfully", normalizeQuiz(quiz));
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const adminCreateQuiz = async (req: Request, res: Response) => {
  try {
    const quiz = await services.createQuiz({
      ...req.body,
      createdBy: req.user!.id,
    });
    sendSuccess(res, "Quiz created successfully", quiz, null, 201);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const adminDeleteQuiz = async (req: Request, res: Response) => {
  try {
    const deleted = await services.deleteQuiz(req.params.id as string);
    if (!deleted) return sendError(res, "Quiz not found", 404);
    sendSuccess(res, "Quiz deleted successfully");
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const adminPublishQuiz = async (req: Request, res: Response) => {
  try {
    const quiz = await services.publishQuiz(req.params.id as string);
    if (!quiz) return sendError(res, "Quiz not found", 404);
    sendSuccess(res, "Quiz published successfully", quiz);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const adminArchiveQuiz = async (req: Request, res: Response) => {
  try {
    const quiz = await services.archiveQuiz(req.params.id as string);
    if (!quiz) return sendError(res, "Quiz not found", 404);
    sendSuccess(res, "Quiz archived successfully", quiz);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const adminPatchQuiz = async (req: Request, res: Response) => {
  try {
    const { lectures, ...safeData } = req.body;
    const quiz = await services.patchQuiz(req.params.id as string, safeData);
    if (!quiz) return sendError(res, "Quiz not found", 404);
    sendSuccess(res, "Quiz updated successfully", quiz);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const adminAddQuizLecture = async (req: Request, res: Response) => {
  try {
    const { title, description } = req.body;
    if (!title?.trim()) return sendError(res, "title is required", 400);
    const quiz = await services.addLectureToQuiz(String(req.params.id), {
      title,
      description,
    });
    if (!quiz) return sendError(res, "Quiz not found", 404);
    sendSuccess(res, "Lecture added successfully", quiz, null, 201);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const adminAddQuizTopic = async (req: Request, res: Response) => {
  try {
    const { title, description } = req.body;
    const lectureIndex = Number(req.params.lectureIndex);
    if (!title?.trim()) return sendError(res, "title is required", 400);
    const quiz = await services.addTopicToLecture(
      String(req.params.id),
      lectureIndex,
      { title, description },
    );
    if (!quiz) return sendError(res, "Quiz not found", 404);
    sendSuccess(res, "Topic added successfully", quiz, null, 201);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const adminAddQuizQuestion = async (req: Request, res: Response) => {
  try {
    const { lectureIndex, topicIndex, type, ...questionData } = req.body;
    if (lectureIndex === undefined || topicIndex === undefined || !type) {
      return sendError(
        res,
        "lectureIndex, topicIndex, and type are required",
        400,
      );
    }
    const question = await services.addQuestionToQuiz(
      req.params.id as string,
      {
        lectureIndex: Number(lectureIndex),
        topicIndex: Number(topicIndex),
        type,
      },
      questionData,
      req.user!.id,
    );
    sendSuccess(res, "Question added successfully", question, null, 201);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const adminUpdateQuizQuestion = async (req: Request, res: Response) => {
  try {
    // Strip placement keys — moving a question between lectures/topics is a
    // separate operation, not part of an in-place edit.
    const { lectureIndex, topicIndex, ...questionData } = req.body;
    const question = await services.updateQuestion(
      req.params.questionId as string,
      questionData,
    );
    if (!question) return sendError(res, "Question not found", 404);
    sendSuccess(res, "Question updated successfully", question);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const adminBatchUploadQuizQuestions = async (
  req: Request,
  res: Response,
) => {
  try {
    const { questions } = req.body;
    const result = await services.batchAddQuestionsToQuiz(
      req.params.id as string,
      questions,
      req.user!.id,
    );
    sendSuccess(
      res,
      `${result.inserted} questions added successfully`,
      result,
      null,
      201,
    );
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const adminRemoveQuizQuestion = async (req: Request, res: Response) => {
  try {
    await services.removeQuestionFromQuiz(
      req.params.id as string,
      req.params.questionId as string,
    );
    sendSuccess(res, "Question removed successfully");
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const adminGenerateQuizAI = async (req: Request, res: Response) => {
  try {
    const {
      quizId,
      courseId,
      topic,
      numberOfQuestions,
      questionTypes,
      difficulty,
      lectureTitle,
    } = req.body;
    const createdBy = req.user!.id;

    const jobId = `quiz-gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    await longQueue.enqueue("ai:generate_quiz", {
      quizId,
      courseId,
      topic,
      numberOfQuestions: numberOfQuestions ?? 20,
      questionTypes: questionTypes ?? ["mcq"],
      difficulty: difficulty ?? "mixed",
      lectureTitle,
      createdBy,
      jobId,
    });

    sendSuccess(res, "Quiz generation job queued.", { jobId }, null, 202);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

// --- EXAM TIMETABLE CONTROLLERS ---

export const adminCreateTimetable = async (req: Request, res: Response) => {
  try {
    const timetable = await services.createTimetable({
      ...req.body,
      createdBy: req.user!.id,
    });
    sendSuccess(res, "Timetable created successfully", timetable, null, 201);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const adminListTimetables = async (req: Request, res: Response) => {
  try {
    const { semester, academicYear } = req.query;
    const filters: Record<string, any> = {};
    if (semester) filters.semester = semester;
    if (academicYear) filters.academicYear = academicYear;
    const timetables = await services.listTimetableSummaries(filters);
    sendSuccess(res, "Timetables retrieved successfully", timetables);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const adminGetTimetable = async (req: Request, res: Response) => {
  try {
    const timetable = await services.getTimetable(req.params.id as string);
    if (!timetable) return sendError(res, "Timetable not found", 404);
    sendSuccess(res, "Timetable retrieved successfully", timetable);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const adminUpdateTimetable = async (req: Request, res: Response) => {
  try {
    const timetable = await services.updateTimetable(
      req.params.id as string,
      req.body,
    );
    if (!timetable) return sendError(res, "Timetable not found", 404);
    sendSuccess(res, "Timetable updated successfully", timetable);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const adminPublishTimetable = async (req: Request, res: Response) => {
  try {
    const timetable = await services.publishTimetable(req.params.id as string);
    if (!timetable) return sendError(res, "Timetable not found", 404);
    sendSuccess(
      res,
      "Timetable published and notifications enqueued",
      timetable,
    );
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const adminAddTimetableEntry = async (req: Request, res: Response) => {
  try {
    const timetable = await services.addTimetableEntry(
      req.params.id as string,
      req.body,
    );
    if (!timetable) return sendError(res, "Timetable not found", 404);
    sendSuccess(res, "Timetable entry added successfully", timetable);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const adminUpdateTimetableEntry = async (
  req: Request,
  res: Response,
) => {
  try {
    const timetable = await services.updateTimetableEntry(
      req.params.id as string,
      req.params.entryId as string,
      req.body,
    );
    if (!timetable) return sendError(res, "Timetable or entry not found", 404);
    sendSuccess(res, "Timetable entry updated successfully", timetable);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const adminRemoveTimetableEntry = async (
  req: Request,
  res: Response,
) => {
  try {
    const timetable = await services.removeTimetableEntry(
      req.params.id as string,
      req.params.entryId as string,
    );
    if (!timetable) return sendError(res, "Timetable not found", 404);
    sendSuccess(res, "Timetable entry removed successfully", timetable);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getMyTimetable = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { semester, academicYear, includePast } = req.query;
    if (!semester || !academicYear) {
      return sendError(res, "semester and academicYear are required", 400);
    }

    const user = await User.findById(userId).select("studentId").lean();
    const studentIdQuery = user?.studentId || "";

    const timetables = await services.getTimetablesForUser(
      userId,
      semester as string,
      academicYear as string,
    );

    const showPast = includePast === "true";
    const now = new Date();

    // Flatten and filter sessions for the student
    const studentSessions: any[] = [];
    for (const timetable of timetables) {
      for (const entry of timetable.entries) {
        for (const session of entry.sessions) {
          // Date filter: skip finished sessions if not requested
          // session.scheduledAt is the start time.
          // We consider it "past" if it finished already (start + duration).
          const timing = getSessionTiming(session, now);
          if (!showPast && timing.isPast) continue;

          let assignedVenue: string | null = null;
          if (studentIdQuery) {
            assignedVenue = resolveVenueForStudentId(
              session.venues,
              studentIdQuery,
            );

            // If the student matches a specific venue in this batch, keep it.
            // If they don't match any but the session has specific ranges, it means they are likely not in THIS batch.
            if (
              !assignedVenue &&
              session.venues.some((v: any) => v.indexStart || v.indexEnd)
            ) {
              continue;
            }
          }

          studentSessions.push({
            ...session,
            _id: session.sessionId || (session as any)._id,
            courseId: entry.courseId,
            courseCode: entry.courseCode,
            courseName: entry.courseName,
            examType: entry.examType,
            semester: timetable.semester,
            academicYear: timetable.academicYear,
            timetableId: timetable._id,
            assignedVenue:
              assignedVenue ||
              (session.venues.length === 1 ? session.venues[0].venue : null),
            timingStatus: toTimingStatus(timing.bucket),
            // Backward compatibility
            venue:
              assignedVenue ||
              (session.venues.length === 1
                ? session.venues[0].venue
                : "See details"),
          });
        }
      }
    }

    // Prioritize Ongoing -> Today -> Upcoming
    const sorted = studentSessions.sort((a, b) =>
      sortByTimetablePriority(a, b, now),
    );

    sendSuccess(res, "Your timetable retrieved successfully", sorted);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const adminSyncTimetable = async (req: Request, res: Response) => {
  try {
    const { startDate, days, semester, academicYear } = req.body;

    const jobId = `admin-sync-${Date.now()}`;
    await longQueue.enqueue("admin:sync_school_timetable", {
      startDate,
      days,
      semester,
      academicYear,
      jobId,
    });

    sendSuccess(
      res,
      "Timetable sync job enqueued successfully",
      { jobId },
      null,
      202,
    );
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const adminTriggerPublicQuizGeneration = async (
  req: Request,
  res: Response,
) => {
  try {
    const { courseId, numberOfQuestions } = req.body;
    const createdBy = req.user!.id;

    const result = await services.triggerPublicQuizGenerationForCourse({
      courseId,
      numberOfQuestions: Math.max(35, Math.min(45, numberOfQuestions || 40)),
      createdBy,
    });

    if (!result.success) {
      sendError(res, result.message, 400);
      return;
    }

    sendSuccess(
      res,
      result.message,
      {
        jobsQueued: result.jobsQueued,
        generationId: result.generationId,
        details: result.details,
      },
      null,
      202,
    );
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const adminTriggerPublicQuizGenerationForMaterial = async (
  req: Request,
  res: Response,
) => {
  try {
    const libraryMaterialId = req.params.libraryMaterialId as string;
    const { numberOfQuestions } = req.body;
    const createdBy = req.user!.id;

    const result = await services.triggerPublicQuizGenerationForMaterial({
      libraryMaterialId,
      numberOfQuestions: Math.max(35, Math.min(45, numberOfQuestions || 40)),
      createdBy,
    });

    if (!result.success) {
      sendError(res, result.message, 400);
      return;
    }

    sendSuccess(
      res,
      result.message,
      {
        jobsQueued: result.jobsQueued,
        generationId: result.generationId,
        details: result.details,
      },
      null,
      202,
    );
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

type VenueMappingLike = {
  venue: string;
  indexStart?: string;
  indexEnd?: string;
};

type TimetableEntryLike = {
  courseCode: string;
  courseName: string;
  venues?: VenueMappingLike[];
};

const EXAM_DEFAULT_DURATION_MINUTES = 180;

type ExamRecencyBucket = 0 | 1 | 2;

const getSessionTiming = (
  session: { scheduledAt: Date | string; durationMinutes?: number },
  now: Date,
): {
  startMs: number;
  endMs: number;
  bucket: ExamRecencyBucket;
  isPast: boolean;
} => {
  const startMs = new Date(session.scheduledAt).getTime();
  const durationMs =
    (session.durationMinutes || EXAM_DEFAULT_DURATION_MINUTES) * 60 * 1000;
  const endMs = startMs + durationMs;
  const nowMs = now.getTime();

  const isPast = nowMs > endMs;
  const isOngoing = nowMs >= startMs && nowMs <= endMs;
  const start = new Date(startMs);
  const isToday =
    start.getFullYear() === now.getFullYear() &&
    start.getMonth() === now.getMonth() &&
    start.getDate() === now.getDate();

  const bucket: ExamRecencyBucket = isOngoing ? 0 : isToday ? 1 : 2;
  return { startMs, endMs, bucket, isPast };
};

const sortByTimetablePriority = <
  T extends { scheduledAt: Date | string; durationMinutes?: number },
>(
  a: T,
  b: T,
  now: Date,
): number => {
  const ta = getSessionTiming(a, now);
  const tb = getSessionTiming(b, now);

  if (ta.bucket !== tb.bucket) return ta.bucket - tb.bucket;
  if (ta.bucket === 0) return ta.endMs - tb.endMs;
  return ta.startMs - tb.startMs;
};

const toTimingStatus = (
  bucket: ExamRecencyBucket,
): "ongoing" | "today" | "upcoming" => {
  if (bucket === 0) return "ongoing";
  if (bucket === 1) return "today";
  return "upcoming";
};

const resolveVenueForStudentId = (
  venues: VenueMappingLike[],
  studentId: string,
): string | null => {
  const numericStudentId = studentId.replace(/\D/g, "");
  if (!numericStudentId) return null;

  const studentValue = BigInt(numericStudentId);

  for (const venue of venues) {
    if (!venue.indexStart || !venue.indexEnd) continue;

    const start = venue.indexStart.replace(/\D/g, "");
    const end = venue.indexEnd.replace(/\D/g, "");
    if (!start || !end) continue;

    const startValue = BigInt(start);
    const endValue = BigInt(end);

    if (studentValue >= startValue && studentValue <= endValue) {
      return venue.venue;
    }
  }

  const venuesWithoutRange = venues.filter(
    (venue) => !venue.indexStart || !venue.indexEnd,
  );
  if (venuesWithoutRange.length === 1) {
    return venuesWithoutRange[0].venue;
  }

  return null;
};

export const getPublicTimetables = async (req: Request, res: Response) => {
  try {
    const { search, studentId, page = 1, limit = 10, includePast } = req.query;
    const studentIdQuery =
      typeof studentId === "string" ? studentId.trim() : "";

    // If a valid numeric studentId is provided, enqueue a background sync to discover and create
    // any new courses and enroll the user without blocking the response.
    if (studentIdQuery && /^\d{7,10}$/.test(studentIdQuery)) {
      // Guest IDs are precious scraping coverage — remember them forever
      // (no TTL) so the periodic sweep probes them even without an account.
      void rememberCrowdsourcedStudentId(studentIdQuery);
      longQueue.enqueue("timetable:enroll_user_courses_from_timetable", {
        studentId: studentIdQuery,
        userId: (req as any).user?.id,
      });
    }

    const { sessions, total, page: currentPage, limit: currentLimit } =
      await services.getPublicTimetableSessions({
        search: typeof search === "string" ? search : "",
        studentId: studentIdQuery,
        page: Number(page) || 1,
        limit: Number(limit) || 10,
        includePast: includePast === "true",
      });

    const now = new Date();
    const enrichedSessions: any[] = [];

    for (const session of sessions) {
      const timing = getSessionTiming(session, now);
      let assignedVenue: string | null = null;

      if (studentIdQuery) {
        assignedVenue = resolveVenueForStudentId(
          session.venues,
          studentIdQuery,
        );
        if (
          !assignedVenue &&
          session.venues?.some((v: any) => v.indexStart || v.indexEnd)
        ) {
          continue;
        }
      }

      enrichedSessions.push({
        ...session,
        assignedVenue,
        timingStatus: toTimingStatus(timing.bucket),
      });
    }

    const pagination = getPaginatedMetadata(total, currentPage, currentLimit);

    sendSuccess(
      res,
      "Public timetables retrieved successfully",
      enrichedSessions,
      pagination,
    );
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const subscribeGuestTimetableReminders = async (
  req: Request,
  res: Response,
) => {
  try {
    const { email, name, studentId, courseCodes, papers } = req.body;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return sendError(res, "A valid email address is required", 400);
    }

    // Guest reminder subscriptions also hand us student IDs — pool them for
    // future scrape sweeps (persistent set, no TTL).
    if (typeof studentId === "string" && studentId.trim()) {
      void rememberCrowdsourcedStudentId(studentId);
    }

    const result = await services.createGuestExamReminder({
      email,
      name: typeof name === "string" ? name.trim() : undefined,
      studentId: typeof studentId === "string" ? studentId.trim() : undefined,
      courseCodes: Array.isArray(courseCodes) ? courseCodes : undefined,
      papers: Array.isArray(papers) ? papers : undefined,
    });

    sendSuccess(
      res,
      "Exam reminders activated successfully! You'll receive countdown alerts and study tips directly to your email.",
      result,
      undefined,
      201,
    );
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

// ---------------------------------------------------------------------------
// Library Material Controllers
// ---------------------------------------------------------------------------

export const submitToLibrary = async (req: Request, res: Response) => {
  try {
    const {
      materialId,
      title,
      description,
      universityId,
      courseId,
      subject,
      year,
      tags,
    } = req.body;

    if (!materialId || !title?.trim()) {
      return sendError(res, "materialId and title are required", 400);
    }

    const material = await Material.findOne({
      _id: materialId,
      uploadedBy: req.user!.id,
      processingStatus: "ready",
    }).lean();

    if (!material) {
      return sendError(
        res,
        "Material not found or not ready for submission",
        404,
      );
    }

    const existing = await LibraryMaterial.findOne({
      materialId,
      submittedBy: req.user!.id,
    });
    if (existing) {
      return sendError(
        res,
        "This material has already been submitted to the library",
        409,
      );
    }

    const entry = await LibraryMaterial.create({
      materialId,
      title: title.trim(),
      description: description?.trim(),
      universityId,
      courseId,
      subject: subject?.trim(),
      year,
      tags: Array.isArray(tags) ? tags : [],
      submittedBy: req.user!.id,
      status: "pending_review",
    });

    sendSuccess(
      res,
      "Material submitted for review",
      { id: entry._id, status: entry.status },
      null,
      201,
    );
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const adminPublishToLibrary = async (req: Request, res: Response) => {
  try {
    const {
      materialId,
      title,
      description,
      universityId,
      courseId,
      subject,
      year,
      tags,
    } = req.body;

    if (!materialId || !title?.trim()) {
      return sendError(res, "materialId and title are required", 400);
    }

    const material = await Material.findOne({
      _id: materialId,
      processingStatus: "ready",
    }).lean();
    if (!material) {
      return sendError(res, "Material not found or not ready", 404);
    }

    const entry = await LibraryMaterial.create({
      materialId,
      title: title.trim(),
      description: description?.trim(),
      universityId,
      courseId,
      subject: subject?.trim(),
      year,
      tags: Array.isArray(tags) ? tags : [],
      submittedBy: req.user!.id,
      status: "published",
      reviewedBy: req.user!.id,
      publishedAt: new Date(),
    });

    sendSuccess(res, "Material published to library", entry, null, 201);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const adminReviewLibraryItem = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { action, rejectionReason } = req.body;

    if (!["publish", "reject"].includes(action)) {
      return sendError(res, "action must be 'publish' or 'reject'", 400);
    }

    const entry = await LibraryMaterial.findById(id);
    if (!entry) return sendError(res, "Library item not found", 404);

    if (action === "publish") {
      entry.status = "published";
      entry.publishedAt = new Date();
    } else {
      entry.status = "rejected";
      entry.rejectionReason = rejectionReason?.trim();
    }
    entry.reviewedBy = req.user!.id as any;
    await entry.save();

    sendSuccess(
      res,
      `Item ${action === "publish" ? "published" : "rejected"}`,
      { id: entry._id, status: entry.status },
    );
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const adminListLibraryItems = async (req: Request, res: Response) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const pageNum = Number(page);
    const limitNum = Number(limit);

    const filter: Record<string, any> = {};
    if (status) filter.status = status;

    const [items, total] = await Promise.all([
      LibraryMaterial.find(filter)
        .populate(
          "materialId",
          "originalName mimeType size pageCount wordCount",
        )
        .populate("submittedBy", "name username")
        .populate("universityId", "name")
        .populate("courseId", "title code")
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      LibraryMaterial.countDocuments(filter),
    ]);

    const pagination = getPaginatedMetadata(total, pageNum, limitNum);
    sendSuccess(res, "Library items retrieved", items, pagination);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getPublicLibrary = async (req: Request, res: Response) => {
  try {
    const {
      universityId,
      courseId,
      subject,
      year,
      tags,
      search,
      page = 1,
      limit = 20,
    } = req.query;
    const pageNum = Number(page);
    const limitNum = Number(limit);

    const filter: Record<string, any> = { status: "published" };
    if (universityId) filter.universityId = universityId;
    if (courseId) filter.courseId = courseId;
    if (subject)
      filter.subject = new RegExp(
        String(subject).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
    if (year) filter.year = Number(year);
    if (tags) filter.tags = { $in: String(tags).split(",") };
    if (search) {
      const re = new RegExp(
        String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
      filter.$or = [
        { title: re },
        { description: re },
        { subject: re },
        { tags: re },
      ];
    }

    const [items, total] = await Promise.all([
      LibraryMaterial.find(filter)
        .populate(
          "materialId",
          "originalName mimeType size pageCount wordCount",
        )
        .populate("universityId", "name shortName")
        .populate("courseId", "title code")
        .sort({ publishedAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      LibraryMaterial.countDocuments(filter),
    ]);

    const pagination = getPaginatedMetadata(total, pageNum, limitNum);
    sendSuccess(res, "Public library retrieved", items, pagination);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getPublicLibraryItem = async (req: Request, res: Response) => {
  try {
    const item = await LibraryMaterial.findOne({
      _id: req.params.id,
      status: "published",
    })
      .populate(
        "materialId",
        "originalName mimeType size pageCount wordCount chunkCount",
      )
      .populate("universityId", "name shortName")
      .populate("courseId", "title code")
      .lean();

    if (!item) return sendError(res, "Library item not found", 404);

    sendSuccess(res, "Library item retrieved", item);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const importLibraryMaterial = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const item = await LibraryMaterial.findById(id)
      .populate("materialId")
      .lean();

    if (!item || item.status !== "published") {
      return sendError(res, "Library item not found or not available", 404);
    }

    const sourceMaterial = item.materialId as any;
    if (!sourceMaterial)
      return sendError(res, "Source material not found", 404);

    // Check if user already has this material (duplicate check by upload ID)
    const existing = await Material.findOne({
      uploadedBy: req.user!.id,
      upload: sourceMaterial.upload,
    }).lean();

    if (existing) {
      return sendError(
        res,
        "You already have this material in your library",
        409,
      );
    }

    if (!(await consumeUsageOnSuccess(req, res, "materialUploads"))) return;

    // Create a personal copy
    const newMaterial = await Material.create({
      uploadedBy: req.user!.id,
      upload: sourceMaterial.upload,
      filename: sourceMaterial.filename,
      originalName: sourceMaterial.originalName,
      mimeType: sourceMaterial.mimeType,
      size: sourceMaterial.size,
      processingStatus: "ready", // Public materials are already processed
      extractedText: sourceMaterial.extractedText,
      chunkCount: sourceMaterial.chunkCount,
      wordCount: sourceMaterial.wordCount,
      pageCount: sourceMaterial.pageCount,
      isImported: true,
      sourceLibraryId: item._id,
      processedAt: new Date(),
    });

    // Increment use count on source
    await LibraryMaterial.findByIdAndUpdate(id, { $inc: { useCount: 1 } });

    sendSuccess(res, "Material added to your library", {
      id: newMaterial._id,
      title: item.title,
    });
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const downloadLibraryMaterial = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const item = await LibraryMaterial.findById(id)
      .populate("materialId")
      .lean();
    if (!item || item.status !== "published") {
      return sendError(res, "Library item not found or not available", 404);
    }

    const material = item.materialId as any;
    if (!material || !material.upload) {
      return sendError(res, "Material source not found", 404);
    }

    const upload = await Upload.findById(material.upload).lean();
    if (!upload || !upload.url) {
      return sendError(res, "File URL not found", 404);
    }

    // Increment use count
    await LibraryMaterial.findByIdAndUpdate(id, { $inc: { useCount: 1 } });

    // Fetch and stream the file
    const response = await axios({
      url: upload.url,
      method: "GET",
      responseType: "stream",
      timeout: 30000, // 30s timeout
    });

    const filename =
      upload.originalFilename || material.originalName || "download";
    const mimetype =
      upload.mimetype || material.mimeType || "application/octet-stream";

    res.setHeader("Content-Type", mimetype);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );

    response.data.pipe(res);

    response.data.on("error", (err: any) => {
      logger.error("Streaming error:", err);
      if (!res.headersSent) {
        sendError(res, "Error streaming file", 500);
      }
    });
  } catch (error: any) {
    logger.error("Download error:", error);
    if (!res.headersSent) {
      sendError(res, error.message, 500);
    }
  }
};
