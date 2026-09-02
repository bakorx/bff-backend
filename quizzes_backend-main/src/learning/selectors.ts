import { Types } from "mongoose";
import {
  Course,
  FlashcardSet,
  Material,
  PersonalQuiz,
  Progress,
  Question,
  Quiz,
  QuizQuestion,
  MaterialChunk,
} from "./models";
import { applySearchFilters, IPaginationOptions } from "@/utils";

// --- FLASHCARD SET SELECTORS ---
export const getFlashcardById = (id: string | Types.ObjectId) =>
  FlashcardSet.findById(id).lean();
export const getFlashcardsByCourse = (
  courseId: string | Types.ObjectId,
  options?: IPaginationOptions,
) => applySearchFilters(FlashcardSet.find({ courseId }).lean(), options);
export const getFlashcardsByUser = (
  userId: string | Types.ObjectId,
  options?: IPaginationOptions,
) =>
  applySearchFilters(FlashcardSet.find({ createdBy: userId }).lean(), options);
export const getPublicFlashcardsByCourse = (
  courseId: string | Types.ObjectId,
  options?: IPaginationOptions,
) =>
  applySearchFilters(
    FlashcardSet.find({ courseId, isPublic: true }).lean(),
    options,
  );
export const getAllFlashcards = (options?: IPaginationOptions) =>
  applySearchFilters(FlashcardSet.find().lean(), options);

// --- MATERIAL SELECTORS ---
export const getMaterialById = (id: string | Types.ObjectId) =>
  Material.findById(id).lean();

// Optionally filter by courseId if present (for backward compatibility)
export const getMaterialsByCourse = (
  courseId: string | Types.ObjectId,
  options?: IPaginationOptions,
) => applySearchFilters(Material.find({ courseId: courseId }).lean(), options);

export const getMaterialsBySession = (
  sessionId: string | Types.ObjectId,
  options?: IPaginationOptions,
) => {
  const normalizedSessionId = String(sessionId);
  if (!Types.ObjectId.isValid(normalizedSessionId)) {
    return applySearchFilters(Material.find({ _id: { $in: [] } }).lean(), options);
  }

  return applySearchFilters(
    Material.find({ sessionId: new Types.ObjectId(normalizedSessionId) })
      .sort({ uploadedAt: -1 })
      .lean(),
    options,
  );
};

export const getMaterialsByUser = (
  userId: string | Types.ObjectId,
  options?: IPaginationOptions,
) => applySearchFilters(Material.find({ uploadedBy: userId }).lean(), options);

export const getAllMaterials = (options?: IPaginationOptions) =>
  applySearchFilters(Material.find().lean(), options);

// --- MATERIAL CHUNK SELECTORS ---

export const getMaterialChunkById = (chunkId: string) =>
  MaterialChunk.findOne({ chunkId }).lean();

export const getChunksByMaterial = (
  materialId: string | Types.ObjectId,
  options?: IPaginationOptions,
) =>
  applySearchFilters(
    MaterialChunk.find({
      materialId:
        typeof materialId === "string"
          ? new Types.ObjectId(materialId)
          : materialId,
    }).lean(),
    options,
  );

export const getChunksBySession = (
  sessionId: string,
  options?: IPaginationOptions,
) =>
  applySearchFilters(
    MaterialChunk.find({ sessionId: String(sessionId) }).lean(),
    options,
  );

// --- PERSONAL QUIZ SELECTORS ---
export const getPersonalQuizById = (id: string | Types.ObjectId) =>
  PersonalQuiz.findById(id)
    .populate("lectures.topics.questionTypes.questions")
    .lean();
export const getPersonalQuizzesByUser = (
  userId: string | Types.ObjectId,
  options?: IPaginationOptions,
) =>
  applySearchFilters(PersonalQuiz.find({ createdBy: userId }).lean(), options);
export const getPersonalQuizzesByCourse = (
  courseId: string | Types.ObjectId,
  options?: IPaginationOptions,
) =>
  applySearchFilters(
    PersonalQuiz.find({ courseId, isPublic: true }).lean(),
    options,
  );
export const getAllPersonalQuizzes = (options?: IPaginationOptions) =>
  applySearchFilters(PersonalQuiz.find().lean(), options);

// --- PROGRESS SELECTORS ---
export const getProgressById = (id: string | Types.ObjectId) =>
  Progress.findById(id).lean();
export const getProgressByUserAndCourse = (
  userId: string | Types.ObjectId,
  courseId: string | Types.ObjectId,
) => Progress.findOne({ userId, courseId }).sort({ createdAt: -1 }).lean();
export const getProgressByUserAndQuiz = (
  userId: string | Types.ObjectId,
  quizId: string | Types.ObjectId,
) => Progress.findOne({ userId, quizId }).sort({ createdAt: -1 }).lean();
export const getAllProgress = (options?: IPaginationOptions) =>
  applySearchFilters(Progress.find().lean(), options);

// --- QUESTION SELECTORS ---
export const getQuestionById = (id: string | Types.ObjectId) =>
  Question.findById(id).lean();
export const getQuestionsByCourse = (
  courseId: string | Types.ObjectId,
  options?: IPaginationOptions,
) => applySearchFilters(Question.find({ courseId }).lean(), options);
export const getApprovedQuestionsByCourse = (
  courseId: string | Types.ObjectId,
  options?: IPaginationOptions,
) =>
  applySearchFilters(
    Question.find({ courseId, isModerated: true }).lean(),
    options,
  );
export const getAllQuestions = (options?: IPaginationOptions) =>
  applySearchFilters(Question.find().lean(), options);

// --- QUIZ QUESTION BUNDLE SELECTORS ---
export const getQuizQuestionById = (id: string | Types.ObjectId) =>
  QuizQuestion.findById(id).lean();
export const getQuizQuestionByCourse = (courseId: string | Types.ObjectId) =>
  QuizQuestion.findOne({ courseId }).lean();
export const getAllQuizQuestions = (options?: IPaginationOptions) =>
  applySearchFilters(QuizQuestion.find().lean(), options);

// --- SYSTEM QUIZ SELECTORS ---
export const getQuizById = (id: string | Types.ObjectId) =>
  Quiz.findById(id).populate("lectures.topics.questionTypes.questions").lean();

export const getPublishedQuizzes = (options?: IPaginationOptions) =>
  applySearchFilters(
    Quiz.find({ status: "published", isAvailable: true }).lean(),
    options,
  );

export const getPublishedQuizById = (id: string | Types.ObjectId) =>
  Quiz.findOne({ _id: id, status: "published" })
    .populate("lectures.topics.questionTypes.questions")
    .lean();

export const getPublishedQuizMetadataById = (id: string | Types.ObjectId) =>
  Quiz.findOne({ _id: id, status: "published" }).lean();

export const getAllQuizzes = (options?: IPaginationOptions) =>
  applySearchFilters(Quiz.find().lean(), options);

export const getQuizzesByCourse = (
  courseId: string | Types.ObjectId,
  options?: IPaginationOptions,
) => applySearchFilters(Quiz.find({ courseId }).lean(), options);

// --- COURSE SELECTORS ---
export const getCourseById = (id: string | Types.ObjectId) =>
  Course.findById(id).lean();
export const getCourseByCode = (code: string) =>
  Course.findOne({ code }).lean();
export const getAllCourses = (
  options?: IPaginationOptions,
  userId?: string | Types.ObjectId,
) => {
  const baseFilter: Record<string, any> = {};
  if (userId) {
    baseFilter.$or = [
      { isCustom: { $ne: true } },
      {
        createdBy:
          typeof userId === "string" ? new Types.ObjectId(userId) : userId,
        isCustom: true,
      },
    ];
  } else {
    baseFilter.isCustom = { $ne: true };
  }
  return applySearchFilters(Course.find(baseFilter).lean(), options);
};

export const getActiveCourses = (
  options?: IPaginationOptions,
  userId?: string | Types.ObjectId,
) => {
  const baseFilter: Record<string, any> = { isDeleted: false };
  if (userId) {
    baseFilter.$or = [
      { isCustom: { $ne: true } },
      {
        createdBy:
          typeof userId === "string" ? new Types.ObjectId(userId) : userId,
        isCustom: true,
      },
    ];
  } else {
    baseFilter.isCustom = { $ne: true };
  }
  return applySearchFilters(Course.find(baseFilter).lean(), options);
};

export const getCustomCoursesByUser = (
  userId: string | Types.ObjectId,
  options?: IPaginationOptions,
) => {
  const userOid =
    typeof userId === "string" ? new Types.ObjectId(userId) : userId;
  return applySearchFilters(
    Course.find({
      createdBy: userOid,
      isCustom: true,
      isDeleted: false,
    }).lean(),
    options,
  );
};

export const countAllCourses = (filter: Record<string, any> = {}) =>
  Course.countDocuments(filter);
export const countAllQuizzes = (filter: Record<string, any> = {}) =>
  Quiz.countDocuments(filter);

