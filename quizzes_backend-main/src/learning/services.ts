import { Types } from "mongoose";
import { invalidateDashboardCache } from "@/app/dashboard/services";
import {
  Course,
  FlashcardSet,
  Material,
  MaterialChunk,
  PersonalQuiz,
  Progress,
  Question,
  Quiz,
  QuizQuestion,
  ExamTimetable,
  UserCourseEnrollment,
  LibraryMaterial,
  QuizAttempt,
} from "./models";
import { publishers } from "@/socket";
import { services as featuresServices } from "@/features";
import { User, services as userServices } from "@/users";
import { format } from "date-fns";
import {
  ScrapedTimetableEntry,
  normalizeCourseCode,
  parseScheduledDateTime,
  fetchUgStudentTimetable,
  getScheduledDates,
  scrapeDailyTimetable,
  normalizeSemester,
  normalizeAcademicYear,
  attachFilenames,
  embedQuery,
  dedupeVenueMappings,
  extractEmbeddedVenueIds,
  rememberCrowdsourcedStudentIds,
  getCrowdsourcedStudentIds,
} from "./utils";
import {
  IFlashcardSet,
  IMaterial,
  IPersonalQuiz,
  IProgress,
  IQuestion,
  IQuiz,
  IQuizQuestion,
  IExamTimetable,
  IExamSession,
  IExamEntry,
  IChangedTimetableEntry,
  IVenueMapping,
  IUserCourseEnrollment,
  MaterialSearchResult,
  ICreateGuestExamReminderInput,
} from "./interfaces";
import { runInTransaction, maskId } from "@/utils";
import { StudySession } from "@/app";
import { isValidObjectId } from "mongoose";
import { nanoid } from "nanoid";
import { randomBytes } from "crypto";
import { shortQueue, longQueue } from "@/schedulers";
import { logger, redisConnection } from "@/config";
import { Contact } from "@/contacts";

const EXAM_REMINDER_DAY_OFFSETS = [7, 3, 1] as const;

const buildExamReminderJobPrefix = (
  timetableId: string | Types.ObjectId,
): string => `exam_reminder_${String(timetableId)}_`;

const buildExamReminderJobId = (params: {
  timetableId: string | Types.ObjectId;
  entryId: string;
  sessionId: string;
  userId: string;
  daysBefore: number;
}): string => {
  const { timetableId, entryId, sessionId, userId, daysBefore } = params;
  return `${buildExamReminderJobPrefix(timetableId)}${entryId}_${sessionId}_${userId}_d${daysBefore}`;
};

export const syncTimetableReminderJobs = async (timetable: IExamTimetable) => {
  if (!timetable.isPublished) return;

  const now = Date.now();
  const timetableId = String((timetable as any)._id);
  const keepJobIds = new Set<string>();

  for (const entry of timetable.entries) {
    const entryId = String((entry as any)._id || entry.courseId);
    const userIds = await getUsersEnrolledInCourses(
      [entry.courseId],
      timetable.semester,
      timetable.academicYear,
    );

    for (const session of entry.sessions) {
      const sessionId = String(
        (session as any).sessionId || (session as any)._id,
      );
      const scheduledAtMs = new Date(session.scheduledAt).getTime();
      if (Number.isNaN(scheduledAtMs) || scheduledAtMs <= now) continue;

      for (const userId of userIds) {
        for (const daysBefore of EXAM_REMINDER_DAY_OFFSETS) {
          const reminderAtMs = scheduledAtMs - daysBefore * 24 * 60 * 60 * 1000;
          const delayMs = reminderAtMs - now;
          if (delayMs <= 0) continue;

          const normalizedUserId = String(userId);
          const jobId = buildExamReminderJobId({
            timetableId,
            entryId,
            sessionId,
            userId: normalizedUserId,
            daysBefore,
          });

          keepJobIds.add(jobId);
          await shortQueue.enqueue(
            "push:exam_reminder",
            {
              userId: normalizedUserId,
              courseId: String(entry.courseId),
              courseCode: entry.courseCode,
              courseName: entry.courseName,
              daysUntil: daysBefore,
              examDate: new Date(scheduledAtMs).toISOString(),
              label: session.label,
              venues: session.venues,
            },
            3,
            jobId,
            delayMs,
          );
        }
      }
    }
  }

  await shortQueue.reconcileJobsByPrefix(
    buildExamReminderJobPrefix(timetableId),
    keepJobIds,
  );
};

// --- FLASHCARD SET SERVICES ---
export const createFlashcard = async (data: Partial<IFlashcardSet>) => {
  return await runInTransaction(async (session) => {
    const flashcard = new FlashcardSet(data);
    return await flashcard.save({ session });
  });
};

export const updateFlashcard = async (
  id: string | Types.ObjectId,
  data: Partial<IFlashcardSet>,
) => {
  return await runInTransaction(async (session) => {
    return await FlashcardSet.findByIdAndUpdate(id, data, {
      returnDocument: "after",
      session,
    });
  });
};

export const deleteFlashcard = async (id: string | Types.ObjectId) => {
  return await runInTransaction(async (session) => {
    return await FlashcardSet.findByIdAndDelete(id, { session });
  });
};

export const linkMaterialToFlashcard = async (
  flashcardId: string | Types.ObjectId,
  materialId: string | Types.ObjectId,
) => {
  return await runInTransaction(async (session) => {
    return await FlashcardSet.findByIdAndUpdate(
      flashcardId,
      { materialId },
      { returnDocument: "after", session },
    );
  });
};

// --- MATERIAL SERVICES ---
export const createMaterial = async (data: Partial<IMaterial>) => {
  return await runInTransaction(async (session) => {
    const material = new Material(data);
    return await material.save({ session });
  });
};

export const updateMaterial = async (
  id: string | Types.ObjectId,
  data: Partial<IMaterial>,
) => {
  return await runInTransaction(async (session) => {
    return await Material.findByIdAndUpdate(id, data, {
      returnDocument: "after",
      session,
    });
  });
};

export const deleteMaterial = async (id: string | Types.ObjectId) => {
  return await runInTransaction(async (session) => {
    return await Material.findByIdAndDelete(id, { session });
  });
};

// --- PERSONAL QUIZ SERVICES ---
export const createPersonalQuiz = async (data: Partial<IPersonalQuiz>) => {
  return await runInTransaction(async (session) => {
    const quiz = new PersonalQuiz(data);
    return await quiz.save({ session });
  });
};

export const updatePersonalQuiz = async (
  id: string | Types.ObjectId,
  data: Partial<IPersonalQuiz>,
) => {
  return await runInTransaction(async (session) => {
    return await PersonalQuiz.findByIdAndUpdate(id, data, {
      returnDocument: "after",
      session,
    });
  });
};

export const deletePersonalQuiz = async (id: string | Types.ObjectId) => {
  return await runInTransaction(async (session) => {
    return await PersonalQuiz.findByIdAndDelete(id, { session });
  });
};

// --- PROGRESS SERVICES ---
export const createProgress = async (data: Partial<IProgress>) => {
  return await runInTransaction(async (session) => {
    const progress = new Progress(data);
    return await progress.save({ session });
  });
};

export const updateProgress = async (
  id: string | Types.ObjectId,
  data: Partial<IProgress>,
) => {
  return await runInTransaction(async (session) => {
    return await Progress.findByIdAndUpdate(id, data, {
      returnDocument: "after",
      session,
    });
  });
};

export const deleteProgress = async (id: string | Types.ObjectId) => {
  return await runInTransaction(async (session) => {
    return await Progress.findByIdAndDelete(id, { session });
  });
};

// --- QUESTION SERVICES ---
export const createQuestion = async (data: Partial<IQuestion>) => {
  return await runInTransaction(async (session) => {
    const question = new Question(data);
    return await question.save({ session });
  });
};

export const updateQuestion = async (
  id: string | Types.ObjectId,
  data: Partial<IQuestion>,
) => {
  return await runInTransaction(async (session) => {
    return await Question.findByIdAndUpdate(id, data, {
      returnDocument: "after",
      session,
    });
  });
};

export const deleteQuestion = async (id: string | Types.ObjectId) => {
  return await runInTransaction(async (session) => {
    return await Question.findByIdAndDelete(id, { session });
  });
};

// --- QUIZ QUESTION BUNDLE SERVICES ---
export const createQuizQuestion = async (data: Partial<IQuizQuestion>) => {
  return await runInTransaction(async (session) => {
    const quizQuestion = new QuizQuestion(data);
    return await quizQuestion.save({ session });
  });
};

export const updateQuizQuestion = async (
  id: string | Types.ObjectId,
  data: Partial<IQuizQuestion>,
) => {
  return await runInTransaction(async (session) => {
    return await QuizQuestion.findByIdAndUpdate(id, data, {
      returnDocument: "after",
      session,
    });
  });
};

export const deleteQuizQuestion = async (id: string | Types.ObjectId) => {
  return await runInTransaction(async (session) => {
    return await QuizQuestion.findByIdAndDelete(id, { session });
  });
};

// --- COURSE SERVICES ---
export const createCourse = async (data: any) => {
  return await runInTransaction(async (session) => {
    const course = new Course(data);
    return await course.save({ session });
  });
};

export const updateCourse = async (id: string | Types.ObjectId, data: any) => {
  return await runInTransaction(async (session) => {
    return await Course.findByIdAndUpdate(id, data, {
      returnDocument: "after",
      session,
    });
  });
};

export const deleteCourse = async (id: string | Types.ObjectId) => {
  return await runInTransaction(async (session) => {
    return await Course.findByIdAndUpdate(
      id,
      { isDeleted: true },
      { returnDocument: "after", session },
    );
  });
};

export const incrementCourseQuestionsCount = async (
  id: string | Types.ObjectId,
  amount: number = 1,
) => {
  return await runInTransaction(async (session) => {
    return await Course.findByIdAndUpdate(
      id,
      { $inc: { approvedQuestionsCount: amount } },
      { returnDocument: "after", session },
    );
  });
};

export const search = async (
  sessionId: string | undefined,
  query: string,
  limit = 5,
  context?: { materialIds?: string[]; courseId?: string },
): Promise<MaterialSearchResult[]> => {
  const queryEmbedding = await embedQuery(query);

  const filter: any = {};
  if (context?.materialIds && context.materialIds.length > 0) {
    filter.materialId = {
      $in: context.materialIds.map((id) => new Types.ObjectId(id)),
    };
  } else if (sessionId && isValidObjectId(sessionId)) {
    // Chunks are indexed by materialId, not sessionId — resolve via Material collection
    const sessionMaterials = await Material.find(
      { sessionId: new Types.ObjectId(sessionId), processingStatus: "ready" },
      { _id: 1 },
    ).lean();
    if (sessionMaterials.length > 0) {
      filter.materialId = { $in: sessionMaterials.map((m) => m._id) };
    }
  } else if (context?.courseId && isValidObjectId(context.courseId)) {
    const materials = await Material.find({ courseId: context.courseId })
      .select("_id")
      .lean();
    filter.materialId = { $in: materials.map((m) => m._id) };
  }

  const MAX_KEYWORDS = 20;
  const keywords = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_KEYWORDS)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const keywordFilter = {
    ...filter,
    ...(keywords.length > 0 && {
      text: { $regex: new RegExp(keywords.join("|"), "i") },
    }),
  };

  if (queryEmbedding.length === 0) {
    const chunks = await MaterialChunk.find(keywordFilter).limit(limit).lean();
    return attachFilenames(
      chunks.map((c) => ({
        chunkId: c.chunkId,
        materialId: String(c.materialId),
        text: c.text,
        section: c.section,
        pageNumber: c.pageNumber,
        score: 0,
      })),
      { sessionId, materialIds: context?.materialIds },
    );
  }

  const preFilter = Object.keys(filter).length > 0 ? filter : undefined;

  const runVectorSearch = async (indexName: string) =>
    MaterialChunk.aggregate([
      {
        $vectorSearch: {
          index: indexName,
          path: "embedding",
          queryVector: queryEmbedding,
          numCandidates: limit * 20,
          limit,
          ...(preFilter && { filter: preFilter }),
        },
      },
      {
        $project: {
          chunkId: 1,
          materialId: 1,
          text: 1,
          section: 1,
          pageNumber: 1,
          score: { $meta: "vectorSearchScore" },
        },
      },
    ]);

  let vectorChunks = [];
  try {
    vectorChunks = await runVectorSearch("session_material_chunks_vector");

    if (vectorChunks.length === 0) {
      vectorChunks = await runVectorSearch("default");
    }

    if (vectorChunks.length > 0) {
      return attachFilenames(vectorChunks, {
        sessionId,
        materialIds: context?.materialIds,
      });
    }
  } catch (err: any) {
    logger.error(
      `[Search] Vector search error: ${err.message}. Falling back to Keywords.`,
    );
  }

  const fallbackChunks = await MaterialChunk.find(keywordFilter)
    .limit(limit)
    .lean();

  return attachFilenames(
    fallbackChunks.map((c) => ({
      chunkId: c.chunkId,
      materialId: String(c.materialId),
      text: c.text,
      section: c.section,
      pageNumber: c.pageNumber,
      score: 0,
    })),
    { sessionId, materialIds: context?.materialIds },
  );
};

export const saveCitation = async (
  sessionId: string | undefined,
  messageId: string,
  materialId: string,
  excerpt: string,
  pageNumber?: number,
): Promise<{ citationId: string; marker: string }> => {
  const mat = await Material.findById(materialId).lean();
  if (!mat) throw new Error("Material not found");

  const citationId = nanoid();

  if (!sessionId || !isValidObjectId(sessionId)) {
    // Session-less citation: return virtual marker
    return { citationId, marker: "[*]" };
  }

  const sess = await StudySession.findById(sessionId);
  if (!sess) throw new Error("Session not found");

  const marker = "[" + (sess.citations.length + 1) + "]";

  const citation = {
    citationId,
    marker,
    materialId,
    filename: mat.filename,
    excerpt,
    pageNumber,
    messageId,
  };

  await runInTransaction(async (session) => {
    await StudySession.findByIdAndUpdate(
      sessionId,
      {
        $push: {
          citations: citation,
        },
      },
      { session },
    );
  });

  if (sess.userId) {
    publishers.appCitation(sessionId, String(sess.userId), citation);
  }

  return { citationId, marker };
};

// --- SYSTEM QUIZ SERVICES ---

export const createQuiz = async (data: Partial<IQuiz>) => {
  return await runInTransaction(async (session) => {
    const quiz = new Quiz(data);
    return await quiz.save({ session });
  });
};

export const deleteQuiz = async (id: string | Types.ObjectId) => {
  return await runInTransaction(async (session) => {
    return await Quiz.findByIdAndDelete(id, { session });
  });
};

const enqueueQuizAvailabilityNotifications = async (quiz: any) => {
  const course = await Course.findById(quiz.courseId).select("code").lean();
  const enrollments = await UserCourseEnrollment.find({
    courseId: quiz.courseId,
    status: "active",
  })
    .select("userId")
    .lean();

  for (const enrollment of enrollments) {
    await shortQueue.enqueue("push:quiz_available", {
      userId: String(enrollment.userId),
      quizTitle: quiz.title,
      courseCode: (course as any)?.code ?? "",
      quizId: String(quiz._id),
    });
  }
};

export const publishQuiz = async (id: string | Types.ObjectId) => {
  const previous = await Quiz.findById(id).select("status isAvailable").lean();

  const quiz = await runInTransaction(async (session) => {
    return await Quiz.findByIdAndUpdate(
      id,
      { status: "published", isAvailable: true },
      { returnDocument: "after", session },
    );
  });

  const wasPrivate = previous?.isAvailable !== true;

  if (quiz && wasPrivate) {
    await enqueueQuizAvailabilityNotifications(quiz);
  }

  return quiz;
};

export const archiveQuiz = async (id: string | Types.ObjectId) => {
  return await runInTransaction(async (session) => {
    return await Quiz.findByIdAndUpdate(
      id,
      { status: "archived", isAvailable: false },
      { returnDocument: "after", session },
    );
  });
};

export const patchQuiz = async (
  id: string | Types.ObjectId,
  data: Partial<IQuiz>,
) => {
  const previous = await Quiz.findById(id).select("status isAvailable").lean();

  const updated = await runInTransaction(async (session) => {
    return await Quiz.findByIdAndUpdate(
      id,
      { $set: data },
      { returnDocument: "after", session },
    );
  });

  const wasPrivate = previous?.isAvailable !== true;
  const isPublishedAvailableNow =
    updated?.status === "published" && updated?.isAvailable === true;

  if (updated && isPublishedAvailableNow && wasPrivate) {
    await enqueueQuizAvailabilityNotifications(updated);
  }

  return updated;
};

export const addQuestionToQuiz = async (
  quizId: string,
  placement: { lectureIndex: number; topicIndex: number; type: string },
  questionData: {
    question: string;
    options: string[];
    answer: string;
    explanation?: string;
    hint?: string;
  },
  authorId: string,
) => {
  return await runInTransaction(async (session) => {
    const quiz = await Quiz.findById(quizId).session(session);
    if (!quiz) throw new Error("Quiz not found");

    const lecture = quiz.lectures[placement.lectureIndex];
    if (!lecture) throw new Error("Lecture not found");

    const topic = lecture.topics[placement.topicIndex];
    if (!topic) throw new Error("Topic not found");

    const normalizedType = placement.type.replace(
      /-/g,
      "_",
    ) as IQuestion["type"];

    const q = new Question({
      ...questionData,
      type: normalizedType,
      author: new Types.ObjectId(authorId),
      courseId: quiz.courseId,
    });
    await q.save({ session });

    const existing = topic.questionTypes.find(
      (qt) => qt.type === normalizedType,
    );
    if (existing) {
      existing.questions.push(q._id);
    } else {
      topic.questionTypes.push({
        type: normalizedType,
        questions: [q._id],
      } as any);
    }

    quiz.markModified("lectures");
    await quiz.save({ session });
    return q;
  });
};

export const addLectureToQuiz = async (
  quizId: string,
  data: { title: string; description?: string },
) => {
  return await runInTransaction(async (session) => {
    const quiz = await Quiz.findById(quizId).session(session);
    if (!quiz) throw new Error("Quiz not found");
    quiz.lectures.push({
      title: data.title,
      description: data.description ?? "",
      order: quiz.lectures.length,
      topics: [],
    } as any);
    quiz.markModified("lectures");
    await quiz.save({ session });
    return quiz;
  });
};

export const addTopicToLecture = async (
  quizId: string,
  lectureIndex: number,
  data: { title: string; description?: string },
) => {
  return await runInTransaction(async (session) => {
    const quiz = await Quiz.findById(quizId).session(session);
    if (!quiz) throw new Error("Quiz not found");
    const lecture = quiz.lectures[lectureIndex];
    if (!lecture) throw new Error(`Lecture at index ${lectureIndex} not found`);
    lecture.topics.push({
      title: data.title,
      description: data.description ?? "",
      order: lecture.topics.length,
      questionTypes: [],
    } as any);
    quiz.markModified("lectures");
    await quiz.save({ session });
    return quiz;
  });
};

export const batchAddQuestionsToQuiz = async (
  quizId: string,
  questions: Array<{
    lectureIndex: number;
    topicIndex: number;
    type: string;
    question: string;
    options: string[];
    answer: string;
    explanation?: string;
    hint?: string;
  }>,
  authorId: string,
) => {
  return await runInTransaction(async (session) => {
    const quiz = await Quiz.findById(quizId).session(session);
    if (!quiz) throw new Error("Quiz not found");

    // Validate all placements upfront
    for (const q of questions) {
      if (!quiz.lectures[q.lectureIndex])
        throw new Error(`Lecture at index ${q.lectureIndex} not found`);
      if (!quiz.lectures[q.lectureIndex].topics[q.topicIndex])
        throw new Error(
          `Topic at index ${q.topicIndex} in lecture ${q.lectureIndex} not found`,
        );
    }

    const questionDocs = questions.map((q) => ({
      question: q.question,
      options: q.options ?? [],
      answer: q.answer,
      explanation: q.explanation ?? "",
      hint: q.hint,
      type: q.type.replace(/-/g, "_") as IQuestion["type"],
      author: new Types.ObjectId(authorId),
      courseId: quiz.courseId,
      isModerated: true,
    }));

    const inserted = await Question.insertMany(questionDocs, { session });

    inserted.forEach((savedQ, i) => {
      const { lectureIndex, topicIndex, type } = questions[i];
      const normalizedType = type.replace(/-/g, "_") as IQuestion["type"];
      const topic = quiz.lectures[lectureIndex].topics[topicIndex];
      const existing = topic.questionTypes.find(
        (qt) => qt.type === normalizedType,
      );
      if (existing) {
        existing.questions.push(savedQ._id);
      } else {
        topic.questionTypes.push({
          type: normalizedType,
          questions: [savedQ._id],
        } as any);
      }
    });

    quiz.markModified("lectures");
    await quiz.save({ session });

    return { inserted: inserted.length, questions: inserted };
  });
};

export const removeQuestionFromQuiz = async (
  quizId: string,
  questionId: string,
) => {
  return await runInTransaction(async (session) => {
    const qid = new Types.ObjectId(questionId);
    await Quiz.findByIdAndUpdate(
      quizId,
      {
        $pull: {
          "lectures.$[].topics.$[].questionTypes.$[].questions": qid,
        },
      },
      { session },
    );
    await Question.findByIdAndDelete(qid, { session });
  });
};

// --- ENROLLMENT SERVICES ---

export const enrollUserInCourse = async (
  userId: string | Types.ObjectId,
  courseId: string | Types.ObjectId,
  semester: string,
  academicYear: string,
) => {
  const normSem = normalizeSemester(semester);
  const normYear = normalizeAcademicYear(academicYear);

  const enrollment = await runInTransaction(async (session) => {
    const userObjectId = new Types.ObjectId(String(userId));
    const courseObjectId = new Types.ObjectId(String(courseId));

    // Mark all OTHER enrollments of this user for this course as completed.
    // Excludes the exact (semester, academicYear) tuple being upserted so the
    // fresh active record below isn't re-marked.
    await UserCourseEnrollment.updateMany(
      {
        userId: userObjectId,
        courseId: courseObjectId,
        $or: [
          { semester: { $ne: normSem } },
          { academicYear: { $ne: normYear } },
        ],
      },
      { $set: { status: "completed" } },
      { session },
    );

    return await UserCourseEnrollment.findOneAndUpdate(
      { userId, courseId, semester: normSem, academicYear: normYear },
      {
        $set: { status: "active" },
        $setOnInsert: { userId, courseId, semester: normSem, academicYear: normYear },
      },
      { upsert: true, returnDocument: "after", session },
    );
  });

  // Enrollment set changed — drop this user's stale dashboard cache.
  await invalidateDashboardCache(userId);
  return enrollment;
};

export const unenrollUserFromCourse = async (
  userId: string | Types.ObjectId,
  courseId: string | Types.ObjectId,
  semester: string,
  academicYear: string,
) => {
  const normSem = normalizeSemester(semester);
  const normYear = normalizeAcademicYear(academicYear);

  const removed = await runInTransaction(async (session) => {
    return await UserCourseEnrollment.findOneAndDelete(
      { userId, courseId, semester: normSem, academicYear: normYear },
      { session },
    );
  });

  // Enrollment set changed — drop this user's stale dashboard cache.
  await invalidateDashboardCache(userId);
  return removed;
};

export const getUserEnrollments = async (
  userId: string | Types.ObjectId,
  semester?: string,
  academicYear?: string,
) => {
  const query: any = { userId, status: "active" };
  if (semester) query.semester = normalizeSemester(semester);
  if (academicYear) query.academicYear = normalizeAcademicYear(academicYear);
  const enrollments = await UserCourseEnrollment.find(query)
    .populate("courseId")
    .lean();

  // Hide enrollments whose course is missing or soft-deleted so this read path
  // matches the dashboard (which filters course.isDeleted). Without this, the
  // raw list can show more courses than the dashboard, e.g. 5 vs 3.
  return enrollments.filter((enrollment) => {
    const course = enrollment.courseId as unknown as
      | { isDeleted?: boolean }
      | null
      | undefined;
    return course != null && course.isDeleted !== true;
  });
};

export const getUsersEnrolledInCourses = async (
  courseIds: (string | Types.ObjectId)[],
  semester: string,
  academicYear: string,
) => {
  const normSem = normalizeSemester(semester);
  const normYear = normalizeAcademicYear(academicYear);

  const enrollments = await UserCourseEnrollment.find({
    courseId: { $in: courseIds },
    semester: normSem,
    academicYear: normYear,
    status: "active",
  })
    .select("userId contactId")
    .lean();
  return enrollments
    .map((e) => e.userId || e.contactId)
    .filter(Boolean)
    .map((id) => String(id));
};

// --- EXAM TIMETABLE SERVICES ---

export const createTimetable = async (data: Partial<IExamTimetable>) => {
  const { semester, academicYear } = data;
  const existing = await ExamTimetable.findOne({
    semester,
    academicYear,
  }).lean();
  if (existing) return existing;

  return await runInTransaction(async (session) => {
    const timetable = new ExamTimetable(data);
    return await timetable.save({ session });
  });
};

export const updateTimetable = async (
  id: string | Types.ObjectId,
  data: Partial<IExamTimetable>,
) => {
  const updated = await runInTransaction(async (session) => {
    return await ExamTimetable.findByIdAndUpdate(id, data, {
      returnDocument: "after",
      session,
    });
  });

  if (updated?.isPublished) {
    await syncTimetableReminderJobs(updated as unknown as IExamTimetable);
  }

  return updated;
};

export const addTimetableEntry = async (
  timetableId: string | Types.ObjectId,
  entry: any,
) => {
  const updated = await runInTransaction(async (session) => {
    const timetable =
      await ExamTimetable.findById(timetableId).session(session);
    if (!timetable) throw new Error("Timetable not found");

    const course = await Course.findById(entry.courseId).session(session);
    if (!course) throw new Error("Course not found");

    const enrichedEntry = {
      ...entry,
      courseCode: (course as any).code,
      courseName: (course as any).title,
      semester: timetable.semester,
      academicYear: timetable.academicYear,
    };

    // If entry has legacy flat fields instead of sessions, wrap them
    if (!enrichedEntry.sessions && enrichedEntry.scheduledAt) {
      enrichedEntry.sessions = [
        {
          sessionId: nanoid(),
          scheduledAt: new Date(enrichedEntry.scheduledAt),
          venues: enrichedEntry.venues || [],
          durationMinutes: enrichedEntry.durationMinutes || 120,
          label: enrichedEntry.label,
        },
      ];
      delete enrichedEntry.scheduledAt;
      delete enrichedEntry.venues;
      delete enrichedEntry.durationMinutes;
      delete enrichedEntry.label;
    }

    return await ExamTimetable.findByIdAndUpdate(
      timetableId,
      { $push: { entries: enrichedEntry } },
      { returnDocument: "after", session },
    );
  });

  if (updated?.isPublished) {
    await syncTimetableReminderJobs(updated as unknown as IExamTimetable);
  }

  return updated;
};

export const updateTimetableEntry = async (
  timetableId: string | Types.ObjectId,
  entryId: string | Types.ObjectId,
  data: any,
) => {
  const updated = await runInTransaction(async (session) => {
    const update: any = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === "sessions" && Array.isArray(value)) {
        update[`entries.$.${key}`] = value.map((s: any) => ({
          ...s,
          sessionId: s.sessionId || nanoid(),
          scheduledAt: new Date(s.scheduledAt),
        }));
      } else {
        update[`entries.$.${key}`] = value;
      }
    }
    return await ExamTimetable.findOneAndUpdate(
      { _id: timetableId, "entries._id": entryId },
      { $set: update },
      { returnDocument: "after", session },
    );
  });

  if (updated?.isPublished) {
    await syncTimetableReminderJobs(updated as unknown as IExamTimetable);
  }

  return updated;
};

export const removeTimetableEntry = async (
  timetableId: string | Types.ObjectId,
  entryId: string | Types.ObjectId,
) => {
  const updated = await runInTransaction(async (session) => {
    return await ExamTimetable.findByIdAndUpdate(
      timetableId,
      { $pull: { entries: { _id: entryId } } },
      { returnDocument: "after", session },
    );
  });

  if (updated?.isPublished) {
    await syncTimetableReminderJobs(updated as unknown as IExamTimetable);
  }

  return updated;
};

export const getTimetable = async (id: string | Types.ObjectId) => {
  return await ExamTimetable.findById(id).lean();
};

export const listTimetables = async (filters: any = {}) => {
  return await ExamTimetable.find(filters).sort({ createdAt: -1 }).lean();
};

/**
 * Lists lightweight timetable metadata for the admin overview, avoiding massive document transfers.
 */
export const listTimetableSummaries = async (filters: any = {}) => {
  return await ExamTimetable.aggregate([
    { $match: filters },
    {
      $project: {
        _id: 1,
        semester: 1,
        academicYear: 1,
        isPublished: 1,
        publishedAt: 1,
        createdBy: 1,
        createdAt: 1,
        updatedAt: 1,
        entryCount: { $size: { $ifNull: ["$entries", []] } },
      },
    },
    { $sort: { createdAt: -1 } },
  ]);
};

export interface PublicTimetableQueryParams {
  search?: string;
  studentId?: string;
  page?: number;
  limit?: number;
  includePast?: boolean;
}

/**
 * High-performance MongoDB native aggregation pipeline for public timetable sessions.
 */
export const getPublicTimetableSessions = async ({
  search = "",
  studentId = "",
  page = 1,
  limit = 20,
  includePast = false,
}: PublicTimetableQueryParams) => {
  const pageNumber = Math.max(1, Number(page) || 1);
  const limitNumber = Math.max(1, Math.min(100, Number(limit) || 20));
  const now = new Date();

  const pipeline: any[] = [
    { $match: { isPublished: true } },
    { $unwind: "$entries" },
  ];

  const cleanSearch = search.trim();
  if (cleanSearch) {
    const escaped = cleanSearch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const searchRegex = new RegExp(escaped, "i");
    pipeline.push({
      $match: {
        $or: [
          { "entries.courseCode": searchRegex },
          { "entries.courseName": searchRegex },
        ],
      },
    });
  }

  pipeline.push({ $unwind: "$entries.sessions" });

  if (!includePast) {
    const ongoingThreshold = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    pipeline.push({
      $match: {
        "entries.sessions.scheduledAt": { $gte: ongoingThreshold },
      },
    });
  }

  pipeline.push({
    $project: {
      _id: { $ifNull: ["$entries.sessions.sessionId", "$entries._id"] },
      sessionId: "$entries.sessions.sessionId",
      label: "$entries.sessions.label",
      courseId: "$entries.courseId",
      courseCode: "$entries.courseCode",
      courseName: "$entries.courseName",
      examType: "$entries.examType",
      semester: "$semester",
      academicYear: "$academicYear",
      timetableId: "$_id",
      scheduledAt: "$entries.sessions.scheduledAt",
      venues: "$entries.sessions.venues",
      durationMinutes: "$entries.sessions.durationMinutes",
    },
  });

  pipeline.push({
    $sort: { scheduledAt: 1 },
  });

  pipeline.push({
    $facet: {
      metadata: [{ $count: "total" }],
      data: [
        { $skip: (pageNumber - 1) * limitNumber },
        { $limit: limitNumber },
      ],
    },
  });

  const [result] = await ExamTimetable.aggregate(pipeline);

  const total = result?.metadata?.[0]?.total || 0;
  const rawSessions = result?.data || [];

  return {
    sessions: rawSessions,
    total,
    page: pageNumber,
    limit: limitNumber,
  };
};

export const publishTimetable = async (
  timetableId: string | Types.ObjectId,
) => {
  const timetable = await runInTransaction(async (session) => {
    return await ExamTimetable.findByIdAndUpdate(
      timetableId,
      { isPublished: true, publishedAt: new Date() },
      { returnDocument: "after", session },
    );
  });

  if (!timetable) throw new Error("Timetable not found");
  await syncTimetableReminderJobs(timetable as unknown as IExamTimetable);

  return timetable;
};

export const getTimetablesForUser = async (
  userId: string | Types.ObjectId,
  semester: string,
  academicYear: string,
) => {
  const enrolledCourses = await UserCourseEnrollment.find({
    userId,
    semester,
    academicYear,
    status: "active",
  })
    .select("courseId")
    .lean();
  const courseIds = enrolledCourses.map((e) => e.courseId);
  if (courseIds.length === 0) return [];

  return await ExamTimetable.aggregate([
    {
      $match: {
        semester,
        academicYear,
        isPublished: true,
        "entries.courseId": { $in: courseIds },
      },
    },
    {
      $project: {
        semester: 1,
        academicYear: 1,
        isPublished: 1,
        publishedAt: 1,
        entries: {
          $filter: {
            input: "$entries",
            as: "entry",
            cond: { $in: ["$$entry.courseId", courseIds] },
          },
        },
      },
    },
  ]);
};

// --- AUTOMATED SYNC SERVICES ---

/**
 * Ensures a course exists in the database.
 * If it doesn't, it creates a "System" course.
 */
export const upsertSystemCourse = async (
  code: string,
  title: string,
  semester: number = 1,
) => {
  const normalizedCode = normalizeCourseCode(code);

  let course = await Course.findOne({ code: normalizedCode }).lean();
  if (!course) {
    course = await Course.findOne({
      code: new RegExp(
        `^${normalizedCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "i",
      ),
    }).lean();
  }
  if (course) return course;

  // Find a super-admin to be the creator
  const admin = await User.findOne({ role: "super_admin" })
    .select("_id")
    .lean();
  if (!admin) throw new Error("No super_admin found to create system courses");

  // Create default course
  return await runInTransaction(async (session) => {
    const newCourse = new Course({
      code: normalizedCode,
      title,
      about: `Automatically synced from University of Ghana Timetable.`,
      semester,
      createdBy: admin._id,
      approvedQuestionsCount: 0,
      creditHours: 3,
    });
    return await newCourse.save({ session });
  });
};

const STUDENT_SYNC_COOLDOWN_SECONDS = 2 * 60 * 60; // 2 hours
const STUDENT_EMPTY_SYNC_COOLDOWN_SECONDS = 5 * 60; // 5 minutes for empty responses

/**
 * Reconciles scraped timetable entries into Course and ExamTimetable collections,
 * and auto-enrolls registered users if effectiveUserId is provided.
 */
/**
 * Reconciles scraped timetable entries into Course and ExamTimetable collections,
 * dynamically maintaining student index number ranges per venue, and auto-enrolling
 * registered users if effectiveUserId is provided.
 */
export const reconcileScrapedTimetableEntries = async (
  scrapedEntries: ScrapedTimetableEntry[],
  effectiveUserId?: string | Types.ObjectId,
  studentId?: string,
) => {
  if (!scrapedEntries || scrapedEntries.length === 0) {
    return { results: [], changedEntries: {} };
  }

  const cleanStudentId = studentId
    ? studentId.trim().replace(/\D/g, "")
    : undefined;
  const studentBigInt = cleanStudentId ? BigInt(cleanStudentId) : null;

  const results: any[] = [];
  const changedEntriesByCourse: Record<string, IChangedTimetableEntry> = {};

  for (const entry of scrapedEntries) {
    try {
      // 1. Auto-create or get Course
      const semester = normalizeSemester(entry.semester);
      const academicYear = normalizeAcademicYear(entry.academicYear);
      const semesterNumber = semester.includes("1") ? 1 : 2;

      const course = await upsertSystemCourse(
        entry.courseCode,
        entry.courseTitle,
        semesterNumber,
      );

      const courseId = course._id as Types.ObjectId;

      // 2. Auto-enroll user if user exists
      if (effectiveUserId) {
        await UserCourseEnrollment.findOneAndUpdate(
          {
            userId: effectiveUserId,
            courseId,
            semester,
            academicYear,
          },
          {
            $setOnInsert: {
              userId: effectiveUserId,
              courseId,
              status: "active",
              semester,
              academicYear,
              enrolledAt: new Date(),
            },
          },
          { upsert: true, returnDocument: "after" },
        );
      }

      // 3. Parse scheduled datetime via standardized scraper utility
      const scheduledAt = parseScheduledDateTime(entry.date, entry.time);

      // No usable exam date (e.g. take-home / not-yet-scheduled courses):
      // keep the course + enrollment created above, but don't fabricate a
      // timetable session. A real session is added on the sync that follows
      // the university publishing an actual date.
      if (!scheduledAt) {
        logger.warn(
          `[Timetable] Skipping session for ${entry.courseCode}: no exam date in source (date="${entry.date}"). It will appear once a date is published.`,
        );
        continue;
      }

      // Build initial venue list with assigned student bounds if available
      const initialVenues: IVenueMapping[] = (entry.venues || []).map((v) => ({
        venue: v.venue,
        indexStart: cleanStudentId || v.indexStart,
        indexEnd: cleanStudentId || v.indexEnd,
      }));

      // If an assignedVenue exists and is not yet in venues array, add it with bounds
      if (
        entry.assignedVenue &&
        !initialVenues.some((v) => v.venue === entry.assignedVenue)
      ) {
        initialVenues.push({
          venue: entry.assignedVenue,
          indexStart: cleanStudentId,
          indexEnd: cleanStudentId,
        });
      }

      // Crowdsourcing memory: every student-ID bound observed on a venue is a
      // valid probe for the per-student API. Pool them (persistent Redis set,
      // no TTL) so coverage survives restarts and Redis flushes.
      const probeIds: string[] = [];
      if (cleanStudentId) probeIds.push(cleanStudentId);
      for (const v of initialVenues) {
        if (v.indexStart) probeIds.push(v.indexStart);
        if (v.indexEnd) probeIds.push(v.indexEnd);
        probeIds.push(...extractEmbeddedVenueIds(v.venue));
      }
      void rememberCrowdsourcedStudentIds(probeIds);

      const sessionData: IExamSession = {
        sessionId: nanoid(),
        label: entry.label || "MAIN",
        scheduledAt,
        venues: dedupeVenueMappings(initialVenues),
        durationMinutes: 120,
      };

      // 4. Reconcile with ExamTimetable and dynamically expand index ranges
      // Retry on MongoDB write conflicts (code 112) up to 3 attempts with backoff.
      let txRetried = false;
      const maxTxRetries = 3;
      let txAttempt = 0;
      while (txAttempt < maxTxRetries) {
        txAttempt++;
        try {
          await runInTransaction(async (dbSession) => {
            let tDoc = await ExamTimetable.findOne({
              semester,
              academicYear,
            }).session(dbSession);

            if (!tDoc) {
              const admin = await User.findOne({ role: "super_admin" })
                .select("_id")
                .lean();
              tDoc = new ExamTimetable({
                semester,
                academicYear,
                isPublished: true,
                publishedAt: new Date(),
                createdBy: admin?._id,
                entries: [],
              });
            }

            let entryIndex = tDoc.entries.findIndex(
              (e) => e.courseCode === entry.courseCode,
            );

            if (entryIndex === -1) {
              tDoc.entries.push({
                courseId,
                courseName: course.title || entry.courseTitle,
                courseCode: course.code || entry.courseCode,
                examType: "final",
                sessions: [sessionData],
                semester: entry.semester,
                academicYear: entry.academicYear,
                isPublished: true,
                isAutoSynced: true,
                invigilators: [],
              } as any);

              changedEntriesByCourse[entry.courseCode] = {
                courseId,
                courseCode: course.code || entry.courseCode,
                sessions: [sessionData],
                semester,
                academicYear,
              };
            } else {
              const existingEntry = tDoc.entries[entryIndex];
              // Same start time = same sitting; STS and graduation label sittings differently.
              // Deduping on label caused spam from "MAIN CAMPUS" vs "MAIN" mismatches.
              const existingSessIndex = existingEntry.sessions.findIndex(
                (s) => s.scheduledAt.getTime() === sessionData.scheduledAt.getTime(),
              );

              if (existingSessIndex === -1) {
                existingEntry.sessions.push(sessionData);
                changedEntriesByCourse[entry.courseCode] = {
                  courseId,
                  courseCode: existingEntry.courseCode,
                  sessions: existingEntry.sessions,
                  semester,
                  academicYear,
                };
              } else {
                // Update venues and dynamically stretch indexStart / indexEnd ranges
                const existingSess = existingEntry.sessions[existingSessIndex];
                const incomingVenues =
                  entry.venues && entry.venues.length > 0
                    ? entry.venues
                    : entry.assignedVenue
                    ? [{ venue: entry.assignedVenue }]
                    : [];

                for (const v of incomingVenues) {
                  const matchedVenue = existingSess.venues.find(
                    (ev) => ev.venue === v.venue,
                  );

                  if (!matchedVenue) {
                    existingSess.venues.push({
                      venue: v.venue,
                      indexStart: cleanStudentId || v.indexStart,
                      indexEnd: cleanStudentId || v.indexEnd,
                    });
                  } else if (cleanStudentId && studentBigInt) {
                    // Dynamically expand indexStart if this student ID is lower
                    if (matchedVenue.indexStart) {
                      const startNum = BigInt(
                        matchedVenue.indexStart.replace(/\D/g, ""),
                      );
                      if (studentBigInt < startNum) {
                        matchedVenue.indexStart = cleanStudentId;
                      }
                    } else {
                      matchedVenue.indexStart = cleanStudentId;
                    }

                    // Dynamically expand indexEnd if this student ID is higher
                    if (matchedVenue.indexEnd) {
                      const endNum = BigInt(
                        matchedVenue.indexEnd.replace(/\D/g, ""),
                      );
                      if (studentBigInt > endNum) {
                        matchedVenue.indexEnd = cleanStudentId;
                      }
                    } else {
                      matchedVenue.indexEnd = cleanStudentId;
                    }
                  }
                }

                // Drop duplicates accumulated across repeated syncs.
                existingSess.venues = dedupeVenueMappings(existingSess.venues);
              }
            }

            tDoc.markModified("entries");
            await tDoc.save({ session: dbSession });
        }); // runInTransaction
        break; // success — exit retry loop
        } catch (err: any) {
          const isWriteConflict =
            err.code === 112 || /write conflict/i.test(err.message);
          if (isWriteConflict && txAttempt < maxTxRetries) {
            txRetried = true;
            await new Promise((r) => setTimeout(r, 150 * txAttempt));
            continue; // retry
          }
          // Non-retryable or max retries exhausted — propagate
          throw err;
        }
      } // while txAttempt < maxTxRetries

      if (txRetried) {
        logger.info(
          `[TimetableSync] ${entry.courseCode}: write-conflict retry succeeded after ${txAttempt} attempt(s).`,
        );
      }

      results.push({
        courseCode: entry.courseCode,
        courseTitle: entry.courseTitle,
        scheduledAt,
        venues: entry.venues,
        assignedVenue: entry.assignedVenue,
        semester: entry.semester,
        academicYear: entry.academicYear,
        timingStatus: "upcoming",
      });
    } catch (err: any) {
      logger.error(
        `[TimetableSync] Error syncing ${entry.courseCode}: ${err.message}`,
      );
    }
  }

  // Auto-enroll may have added courses for this user — drop their stale
  // dashboard cache once (not per course) after the whole reconcile.
  if (effectiveUserId) {
    await invalidateDashboardCache(effectiveUserId);
  }

  return { results, changedEntries: changedEntriesByCourse };
};

/**
 * Syncs the timetable for a specific student ID in the background:
 * 1. Checks Redis 2-hour cooldown to avoid redundant API hits across workers/restarts.
 * 2. Resolves registered user for auto-enrollment if applicable.
 * 3. Fetches official exam entries from the university REST endpoint.
 * 4. Reconciles Course, UserCourseEnrollment, and ExamTimetable (including venue index ranges).
 * 5. Triggers background reminder reconciliation on longQueue.
 */
export const syncTimetableByStudentId = async (
  studentId: string,
  userId?: string | Types.ObjectId,
) => {
  const cleanId = studentId.trim().replace(/\D/g, "");
  if (!cleanId || cleanId.length < 7 || cleanId.length > 10) return [];

  const redisCacheKey = `timetable:sync:cooldown:${cleanId}`;

  // Check Redis 30-minute cooldown to prevent repeated scrapings
  // User requested 30 minutes because "a lot can happen in 2 hours"
  try {
    const isRecentlySynced = await redisConnection.get(redisCacheKey);
    if (isRecentlySynced) {
      logger.info(
        `[TimetableSync] Student ID ${maskId(cleanId)} was synced recently (30-min cache hit). Skipping redundant fetch.`,
      );
      return [];
    }
  } catch (err: any) {
    logger.warn(`[TimetableSync] Redis cooldown check failed: ${err.message}`);
  }

  // Resolve user if registered (enables auto-enrollment)
  const user = await userServices.resolveStudentUser(cleanId, userId);
  const effectiveUserId = user?._id || userId;

  if (effectiveUserId) {
    logger.info(
      `[TimetableSync] Syncing timetable for registered user ${maskId(String(effectiveUserId))} (Student ID: ${maskId(cleanId)})`,
    );
  } else {
    logger.info(
      `[TimetableSync] Crowdsourcing timetable discovery for Student ID: ${maskId(cleanId)}`,
    );
  }

  const scrapedEntries = await fetchUgStudentTimetable(cleanId);

  // If entries were found, cache for 2 hours; if 0 entries, cache for 5 minutes
  const cooldownTtl =
    scrapedEntries && scrapedEntries.length > 0
      ? STUDENT_SYNC_COOLDOWN_SECONDS
      : STUDENT_EMPTY_SYNC_COOLDOWN_SECONDS;

  try {
    await redisConnection.set(redisCacheKey, "1", "EX", cooldownTtl);
  } catch (err: any) {
    logger.warn(`[TimetableSync] Redis cooldown set failed: ${err.message}`);
  }

  if (!scrapedEntries || scrapedEntries.length === 0) return [];

  const { results } = await reconcileScrapedTimetableEntries(
    scrapedEntries,
    effectiveUserId,
    cleanId,
  );

  // Per-student fetches add course options / context only — STS is the
  // source of truth for changes, so we intentionally do NOT notify here.

  // Asynchronously trigger reminder reconciliation on longQueue (non-blocking background task)
  const latestTimetable = await ExamTimetable.findOne({
    isPublished: true,
  })
    .sort({ updatedAt: -1 })
    .select("_id")
    .lean();
  if (latestTimetable) {
    longQueue.enqueue("timetable:reconcile_reminders", {
      timetableId: String(latestTimetable._id),
    });
  }

  // Emit real-time WebSocket event to notify watching clients in room `timetable:${cleanId}`
  publishers.timetableSynced({
    studentId: cleanId,
    count: results.length,
    entries: results,
  });

  return results;
};

/**
 * Sweeps the university's official exam timetable and reconciles it into the
 * published ExamTimetable. The source is selected by the `use_sts_sync`
 * feature flag (admin-toggleable at /admin/system/features) so we can flip
 * scrapers without a deploy if the school deprecates one of the APIs again:
 *
 *   - flag ON (seeded default): the school-wide STS scraper — every course on
 *     each scheduled exam date, venue mappings with full index ranges, no
 *     dependence on any single student ID.
 *   - flag OFF: the per-student graduation API sweep across registered users'
 *     student IDs plus the persistent crowdsourced pool.
 *
 * Independently of the flag, per-student graduation-API fetches also happen
 * on demand via public search-by-ID and the course-enrollment runner.
 */
export const syncSchoolTimetable = async (
  _startDate?: Date,
  _days: number = 14,
  _semester: string = "Semester 2",
  _academicYear: string = "2025-2026",
  _isOverrideConfirmation: boolean = false,
) => {
  const useSts = await featuresServices.isEnabled("use_sts_sync");
  logger.info(
    `[SyncSchoolTimetable] Starting sweep (source: ${useSts ? "STS school-wide" : "graduation per-student"})...`,
  );
  if (useSts) {
    return syncSchoolTimetableViaSts();
  }
  return syncSchoolTimetableViaStudentIds();
};

/**
 * STS flow: sweep every scheduled exam date from sts.ug.edu.gh. This is the
 * baseline source of truth — it needs no individual student IDs and returns
 * every venue mapping with its full index range. Per-student graduation-API
 * fetches happen only on demand (public search-by-ID, the enrollment runner,
 * or the graduation-mode sweep) — never fanned out from here.
 */
const syncSchoolTimetableViaSts = async () => {

  const scheduledDates = await getScheduledDates();
  if (scheduledDates.length === 0) {
    logger.warn(
      "[SyncSchoolTimetable] STS returned no scheduled exam dates; nothing to sync.",
    );
    return { totalDates: 0, totalEntriesSynced: 0 };
  }

  logger.info(
    `[SyncSchoolTimetable] STS reports ${scheduledDates.length} scheduled exam date(s).`,
  );

  let totalEntriesSynced = 0;
  const sweepChanges: Record<string, IChangedTimetableEntry> = {};
  for (const dateStr of scheduledDates) {
    try {
      const scrapedEntries = await scrapeDailyTimetable(dateStr);
      if (scrapedEntries.length > 0) {
        const { changedEntries } =
          await reconcileScrapedTimetableEntries(scrapedEntries);
        Object.assign(sweepChanges, changedEntries);
        totalEntriesSynced += scrapedEntries.length;
      }
      // Polite delay between university page scrapes
      await new Promise((r) => setTimeout(r, 200));
    } catch (err: any) {
      logger.error(
        `[SyncSchoolTimetable] Failed STS sync for ${dateStr}: ${err.message}`,
      );
    }
  }

  // New/rescheduled papers discovered this sweep — notify enrolled students.
  try {
    if (Object.keys(sweepChanges).length > 0) {
      await notifyConsolidatedTimetableChanges(sweepChanges);
    }
  } catch (err: any) {
    logger.warn(
      `[SyncSchoolTimetable] Failed to send change notifications: ${err.message}`,
    );
  }

  // Per-student syncs reconcile reminders per fetch; the school-wide sweep
  // owns that once per sweep for the latest published timetable.
  try {
    const latestTimetable = await ExamTimetable.findOne({ isPublished: true })
      .sort({ updatedAt: -1 })
      .select("_id")
      .lean();
    if (latestTimetable) {
      await longQueue.enqueue("timetable:reconcile_reminders", {
        timetableId: String(latestTimetable._id),
      });
    }
  } catch (err: any) {
    logger.warn(
      `[SyncSchoolTimetable] Failed to queue reminder reconciliation: ${err.message}`,
    );
  }

  logger.info(
    `[SyncSchoolTimetable] Completed STS sweep: ${totalEntriesSynced} entries across ${scheduledDates.length} date(s).`,
  );
  return {
    totalDates: scheduledDates.length,
    totalEntriesSynced,
  };
};

/**
 * Graduation-API fallback flow: sweep the per-student graduation API across
 * every known student ID — registered users' IDs plus the persistent
 * crowdsourced pool (guest lookups + venue range endpoints), because no
 * single ID is the source of truth for a crowdsourced timetable. Each fetch
 * honors the normal cooldown; per-fetch reminder reconciliation and change
 * notifications live in `syncTimetableByStudentId` / reconcile.
 */
const syncSchoolTimetableViaStudentIds = async () => {
  const usersWithStudentId = await User.find({
    studentId: { $exists: true, $ne: "" },
  })
    .select("studentId _id")
    .lean();

  const distinctIds = new Set<string>();
  const idToUserId = new Map<string, string>();
  for (const u of usersWithStudentId) {
    if (u.studentId) {
      const clean = u.studentId.trim().replace(/\D/g, "");
      if (clean) {
        distinctIds.add(clean);
        idToUserId.set(clean, String(u._id));
      }
    }
  }

  // Merge the crowdsourced pool — losing guest/venue-derived IDs hurts coverage.
  const crowdIds = await getCrowdsourcedStudentIds();
  let crowdAdded = 0;
  for (const rawId of crowdIds) {
    const clean = rawId.trim().replace(/\D/g, "");
    if (clean && !distinctIds.has(clean)) {
      distinctIds.add(clean);
      crowdAdded++;
    }
  }

  // Probe every venue range endpoint recorded on stored sessions too. The
  // Redis pool only fills as ranges are observed going forward; the stored
  // history covers the whole school (and survives a Redis flush).
  interface IStoredVenueRange {
    venue?: string;
    indexStart?: string;
    indexEnd?: string;
  }
  const timetablesWithRanges = (await ExamTimetable.find({
    isPublished: true,
  })
    .select("entries.sessions.venues")
    .lean()) as unknown as {
    entries?: { sessions?: { venues?: IStoredVenueRange[] }[] }[];
  }[];

  let rangeAdded = 0;
  for (const timetable of timetablesWithRanges) {
    for (const entry of timetable.entries ?? []) {
      for (const session of entry.sessions ?? []) {
        for (const venue of session.venues ?? []) {
          const rangeIds = [
            venue.indexStart,
            venue.indexEnd,
            ...extractEmbeddedVenueIds(venue.venue ?? ""),
          ];
          for (const rawId of rangeIds) {
            const clean = String(rawId ?? "").replace(/\D/g, "");
            if (
              clean.length >= 7 &&
              clean.length <= 10 &&
              !distinctIds.has(clean)
            ) {
              distinctIds.add(clean);
              rangeAdded++;
            }
          }
        }
      }
    }
  }

  logger.info(
    `[SyncSchoolTimetable] Sweeping ${distinctIds.size} distinct student ID(s) (${crowdAdded} from the crowdsourced pool, ${rangeAdded} from stored venue ranges).`,
  );

  let totalSynced = 0;
  for (const sid of distinctIds) {
    try {
      const userId = idToUserId.get(sid);
      await syncTimetableByStudentId(sid, userId);
      totalSynced++;
      // Polite delay between university API requests
      await new Promise((r) => setTimeout(r, 200));
    } catch (err: any) {
      logger.error(
        `[SyncSchoolTimetable] Failed sync for student ${maskId(sid)}: ${err.message}`,
      );
    }
  }

  logger.info(
    `[SyncSchoolTimetable] Completed graduation-API sweep of ${totalSynced}/${distinctIds.size} student schedules.`,
  );
  return { totalStudents: distinctIds.size, totalSynced };
};

// Verification logic removed for simpler session-based reconciliation

/**
 * Fans out consolidated timetable-change notifications for courses changed
 * during reconciliation. Groups changes by term (semester + academic year);
 * a change touching a session within the next 48h is escalated to urgent.
 */
export const notifyConsolidatedTimetableChanges = async (
  changedEntries: Record<string, IChangedTimetableEntry>,
): Promise<void> => {
  const entries = Object.values(changedEntries);
  if (entries.length === 0) return;

  const URGENT_WINDOW_MS = 48 * 60 * 60 * 1000;
  const now = Date.now();

  const byTerm = new Map<string, IChangedTimetableEntry[]>();
  for (const entry of entries) {
    const key = `${entry.semester}|${entry.academicYear}`;
    const bucket = byTerm.get(key) ?? [];
    bucket.push(entry);
    byTerm.set(key, bucket);
  }

  for (const [termKey, termEntries] of byTerm) {
    const [semester, academicYear] = termKey.split("|");
    const isUrgent = termEntries.some((entry) =>
      entry.sessions.some((session) => {
        const at = session.scheduledAt.getTime();
        return at >= now && at - now <= URGENT_WINDOW_MS;
      }),
    );

    await notifyTimetableChangesConsolidated(
      Object.fromEntries(termEntries.map((e) => [e.courseCode, e])),
      isUrgent,
      semester,
      academicYear,
    );
  }
};

/**
 * Consolidated notifications for multiple course changes.
 */
export const notifyTimetableChangesConsolidated = async (
  changedEntries: Record<
    string,
    { courseId: Types.ObjectId; courseCode: string; sessions: IExamSession[] }
  >,
  isUrgent: boolean = false,
  semester: string = "Semester 1",
  academicYear: string = "2025-2026",
) => {
  const courseIds = Object.values(changedEntries).map((e) => e.courseId);

  // Find all unique students enrolled in ANY of these courses
  const enrollments = await UserCourseEnrollment.find({
    courseId: { $in: courseIds },
    semester,
    academicYear,
    status: "active",
  })
    .select("userId courseId")
    .lean();

  if (enrollments.length === 0) return;

  // Group by user
  const userChanges = new Map<string, typeof changedEntries>();
  for (const enrollment of enrollments) {
    const uId = String(enrollment.userId);
    const cId = String(enrollment.courseId);

    // Find matching change
    const changeEntry = Object.values(changedEntries).find(
      (e) => String(e.courseId) === cId,
    );
    if (changeEntry) {
      if (!userChanges.has(uId)) userChanges.set(uId, {});
      userChanges.get(uId)![changeEntry.courseCode] = changeEntry;
    }
  }

  const type = isUrgent ? "urgent_timetable_alert" : "timetable_change";

  for (const [userId, courses] of userChanges.entries()) {
    const courseCodes = Object.keys(courses);
    const prefixes = [
      ...new Set(
        courseCodes.map((code) => code.match(/^[A-Za-z]+/)?.[0] || code),
      ),
    ].sort();

    const title = isUrgent
      ? `URGENT: ${prefixes.join(", ")} Exam Changes`
      : `Timetable Update: ${prefixes.join(", ")}`;

    const codeList = courseCodes.map((c) => `**${c}**`).join(", ");

    const body = isUrgent
      ? `The official exam schedule for ${codeList} has just changed.\n\nPlease check the portal immediately for your updated session details.`
      : `There have been updates to your exam schedule for: ${codeList}.\n\nYou can view the new details in the academics section of the portal.`;

    await shortQueue.enqueue("push:timetable_change", {
      userId,
      type,
      title,
      body,
      metadata: { changedCourses: courseCodes },
    });
  }

  logger.info(
    `[Notify] Queued ${userChanges.size} consolidated notifications for ${Object.keys(changedEntries).length} courses.`,
  );
};

/**
 * Notifies all enrolled students about a change in their exam timetable.
 */
export const notifyTimetableChange = async (
  courseId: Types.ObjectId,
  courseCode: string,
  newSessions: IExamSession[],
  isUrgent: boolean = false,
  semester: string = "Semester 1",
  academicYear: string = "2025-2026",
) => {
  // Find all current enrollments for this course for the SPECIFIC semester/year
  const enrollments = await UserCourseEnrollment.find({
    courseId,
    semester,
    academicYear,
    status: "active",
  })
    .select("userId")
    .lean();

  if (enrollments.length === 0) return;

  const type = isUrgent ? "urgent_timetable_alert" : "timetable_change";
  const title = isUrgent
    ? `URGENT: ${courseCode} Exam Change`
    : `${courseCode} Timetable Update`;

  // Format the entries into a readable list
  const sessionLines = newSessions
    .map((sess) => {
      const timeStr = format(
        new Date(sess.scheduledAt),
        "eeee, MMMM do 'at' h:mm a",
      );
      const venueLines = sess.venues
        .map((v: any) => {
          const rangeStr =
            v.indexStart && v.indexEnd
              ? ` (Range: ${v.indexStart} - ${v.indexEnd})`
              : "";
          return `\n    - ${v.venue}${rangeStr}`;
        })
        .join("");

      const labelStr = sess.label ? ` (${sess.label})` : "";
      return `- ${timeStr}${labelStr} | Venues:${venueLines}`;
    })
    .join("\n\n");

  const body = isUrgent
    ? `The official schedule for ${courseCode} has Changed just now.\n\nNew Sessions:\n${sessionLines}\n\nPlease check the portal immediately.`
    : `There has been a update in the exam schedule for ${courseCode}.\n\nNew Sessions:\n${sessionLines}\n\nYou can view your full timetable in the academics section.`;

  for (const enrollment of enrollments) {
    await shortQueue.enqueue("push:timetable_change", {
      userId: String(enrollment.userId),
      type,
      title,
      body,
      courseId: String(courseId),
      courseCode,
      metadata: {
        courseCode,
        sessions: newSessions,
      },
    });
  }

  logger.info(
    `[Notify] Queued ${enrollments.length} batched notifications for ${courseCode}.`,
  );
};

/**
 * Finds the specific venue assigned to a student based on their index number.
 */
export const getVenueForStudent = (
  entry: IExamEntry,
  studentIndex: string,
  sessionId?: string,
) => {
  for (const session of entry.sessions) {
    // If sessionId is provided, only check that session
    if (
      sessionId &&
      String((session as any)._id || session.sessionId) !== sessionId
    )
      continue;

    for (const mapping of session.venues) {
      if (isIndexInRange(studentIndex, mapping.indexStart, mapping.indexEnd)) {
        return { session, venue: mapping.venue };
      }
    }
  }
  return null;
};

function isIndexInRange(index: string, start?: string, end?: string): boolean {
  if (!start || !end) return false;

  // Try numeric comparison first
  const idx = parseInt(index.replace(/\D/g, ""), 10);
  const s = parseInt(start.replace(/\D/g, ""), 10);
  const e = parseInt(end.replace(/\D/g, ""), 10);

  if (!isNaN(idx) && !isNaN(s) && !isNaN(e)) {
    return idx >= s && idx <= e;
  }

  // Fallback to string comparison
  return index.trim() >= start.trim() && index.trim() <= end.trim();
}

/**
 * Trigger public quiz generation for a single library material document.
 * Does not require an upcoming exam — useful for admin-initiated generation on demand.
 */
export const triggerPublicQuizGenerationForMaterial = async (params: {
  libraryMaterialId: string | Types.ObjectId;
  numberOfQuestions?: number;
  createdBy: string | Types.ObjectId;
}) => {
  const { libraryMaterialId, numberOfQuestions = 40, createdBy } = params;
  const generationId = nanoid();

  if (!isValidObjectId(libraryMaterialId)) {
    throw new Error("Invalid libraryMaterialId");
  }

  const libraryMaterial =
    await LibraryMaterial.findById(libraryMaterialId).lean();
  if (!libraryMaterial) {
    return {
      success: false,
      message: "Library material not found",
      jobsQueued: 0,
      generationId,
    };
  }

  const courseId = libraryMaterial.courseId
    ? String(libraryMaterial.courseId)
    : undefined;

  const clampedQuestions = Math.max(35, Math.min(45, numberOfQuestions));
  const materialId = String(libraryMaterial._id);
  const materialTitle = libraryMaterial.title || "Unknown Material";
  const jobId = `public-quiz-single-${materialId}-${Date.now()}`;

  await longQueue.enqueue(
    "ai:public_quiz_generation",
    {
      courseId: courseId || "",
      materialId,
      materialTitle,
      numberOfQuestions: clampedQuestions,
      generationId,
      createdBy: String(createdBy),
      quizPreset: "public",
      jobId,
    },
    3,
    jobId,
  );

  return {
    success: true,
    message: `Queued quiz generation for "${materialTitle}"`,
    jobsQueued: 1,
    generationId,
    details: [{ sessionId: jobId, materialId, materialTitle }],
  };
};

/**
 * Trigger public quiz generation for a specific course.
 * Finds upcoming exams, matches library materials, and enqueues quizzes with configurable question count.
 */
export const triggerPublicQuizGenerationForCourse = async (params: {
  courseId: string | Types.ObjectId;
  numberOfQuestions?: number;
  createdBy: string | Types.ObjectId;
}) => {
  const { courseId, numberOfQuestions = 40, createdBy } = params;
  const generationId = nanoid();

  if (!isValidObjectId(courseId)) {
    throw new Error("Invalid courseId");
  }

  const course = await Course.findById(courseId).lean();
  if (!course) {
    throw new Error("Course not found");
  }

  // 1. Find upcoming exams for this course within the next 30 days
  const now = new Date();
  const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const upcomingExams = await ExamTimetable.findOne({
    isPublished: true,
    "entries.courseId": new Types.ObjectId(courseId),
    "entries.sessions.scheduledAt": {
      $gte: now,
      $lte: thirtyDaysLater,
    },
  })
    .lean()
    .then((timetable) => {
      if (!timetable) return [];
      return timetable.entries
        .filter((entry: any) => String(entry.courseId) === String(courseId))
        .flatMap((entry: any) =>
          entry.sessions.filter((session: any) => {
            const sessionDate = new Date(session.scheduledAt);
            return sessionDate >= now && sessionDate <= thirtyDaysLater;
          }),
        );
    });

  if (upcomingExams.length === 0) {
    return {
      success: false,
      message: "No upcoming exams found for this course",
      jobsQueued: 0,
      generationId,
    };
  }

  // 2. Find published library materials matching this course
  const normalizedCode = (course.code || "").toLowerCase().trim();
  const normalizedName = (course.title || "").toLowerCase().trim();

  const matchedMaterials = await LibraryMaterial.find({
    $or: [
      { courseId: new Types.ObjectId(courseId) },
      {
        $expr: {
          $or: [
            {
              $regexMatch: {
                input: { $toLower: "$title" },
                regex: normalizedCode,
              },
            },
            {
              $regexMatch: {
                input: { $toLower: "$subject" },
                regex: normalizedCode,
              },
            },
            {
              $regexMatch: {
                input: { $toLower: "$title" },
                regex: normalizedName,
              },
            },
            {
              $regexMatch: {
                input: { $toLower: "$subject" },
                regex: normalizedName,
              },
            },
          ],
        },
      },
    ],
    status: "published",
  }).lean();

  if (matchedMaterials.length === 0) {
    return {
      success: false,
      message: "No published library materials found for this course",
      jobsQueued: 0,
      generationId,
    };
  }

  // 3. Create one autonomous session per material for rich AI-powered quiz generation
  const sessions: Array<{
    sessionId: string;
    materialId: string;
    materialTitle: string;
  }> = [];

  for (const material of matchedMaterials) {
    const materialId = String(material._id);
    const materialTitle = material.title || "Unknown Material";

    // Enqueue generation via handler which will call zFlow for rich synthesis
    const jobId = `public-quiz-rich-gen-${String(courseId)}-${materialId}-${Date.now()}`;

    await longQueue.enqueue(
      "ai:public_quiz_generation",
      {
        courseId: String(courseId),
        materialId,
        materialTitle,
        numberOfQuestions,
        generationId,
        createdBy: String(createdBy),
        quizPreset: "public",
        jobId,
      },
      3,
      jobId,
    );

    sessions.push({
      sessionId: jobId,
      materialId,
      materialTitle,
    });
  }

  return {
    success: true,
    message: `Queued ${sessions.length} comprehensive quiz generation jobs for ${course.code}`,
    jobsQueued: sessions.length,
    generationId,
    details: sessions,
  };
};

const WINDOW_MS = 12 * 60 * 60 * 1000; // 12 hours
const FREE_TIER_LIMIT = 3;
const FREE_TIER = "cooked";

function windowStart(): Date {
  return new Date(Date.now() - WINDOW_MS);
}

/**
 * Check the 12-hour rolling attempt count for a user.
 * If under the limit (or on a paid tier), insert a pending attempt entry.
 * Returns { allowed: true } or throws with a user-facing message.
 */
export async function checkAndStartAttempt(
  userId: string | Types.ObjectId,
  quizId: string | Types.ObjectId,
  planTier: string | null,
): Promise<void> {
  const uid = new Types.ObjectId(String(userId));
  const qid = new Types.ObjectId(String(quizId));

  if (planTier && planTier !== FREE_TIER) {
    // Paid tier — no limit, just record the attempt
    await QuizAttempt.findOneAndUpdate(
      { userId: uid },
      {
        $push: {
          attempts: { quizId: qid, status: "pending", attemptedAt: new Date() },
        },
      },
      { upsert: true, returnDocument: "after" },
    );
    return;
  }

  // Free tier — enforce limit within transaction
  await runInTransaction(async (session) => {
    const cutoff = windowStart();

    // Prune entries older than 12h and count confirmed attempts in one go
    const doc = await QuizAttempt.findOneAndUpdate(
      { userId: uid },
      {
        $pull: { attempts: { attemptedAt: { $lt: cutoff } } },
      },
      { upsert: true, returnDocument: "after", session },
    );

    const pendingCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h window for pending
    const currentAttempts = (doc?.attempts ?? []).filter(
      (a) =>
        (a.status === "confirmed" && a.attemptedAt >= cutoff) ||
        (a.status === "pending" && a.attemptedAt >= pendingCutoff),
    );

    if (currentAttempts.length >= FREE_TIER_LIMIT) {
      // Find the earliest active attempt — when it expires is when the next slot opens
      const earliest = currentAttempts.reduce((min, a) =>
        a.attemptedAt < min.attemptedAt ? a : min,
      );
      const nextAttemptAt = new Date(
        earliest.attemptedAt.getTime() + WINDOW_MS,
      );

      const err = new Error(
        `You've used all ${FREE_TIER_LIMIT} quiz attempts for this window. Upgrade to unlock unlimited attempts.`,
      ) as Error & { statusCode: number; nextAttemptAt: Date };
      err.statusCode = 403;
      err.nextAttemptAt = nextAttemptAt;
      throw err;
    }

    await QuizAttempt.updateOne(
      { userId: uid },
      {
        $push: {
          attempts: { quizId: qid, status: "pending", attemptedAt: new Date() },
        },
      },
      { session },
    );
  });
}

/**
 * Flip the most recent pending attempt for a user+quiz to confirmed.
 */
export async function confirmAttempt(
  userId: string | Types.ObjectId,
  quizId: string | Types.ObjectId,
): Promise<void> {
  const uid = new Types.ObjectId(String(userId));
  const qid = new Types.ObjectId(String(quizId));
  const cutoff = windowStart();

  await QuizAttempt.updateOne(
    {
      userId: uid,
      attempts: {
        $elemMatch: {
          quizId: qid,
          status: "pending",
          attemptedAt: { $gte: cutoff },
        },
      },
    },
    {
      $set: { "attempts.$[entry].status": "confirmed" },
    },
    {
      arrayFilters: [
        {
          "entry.quizId": qid,
          "entry.status": "pending",
          "entry.attemptedAt": { $gte: cutoff },
        },
      ],
    },
  );
}

export interface RemainingAttemptsResult {
  remaining: number | null; // null = unlimited (paid tier)
  nextAttemptAt: Date | null; // null when not exhausted or on paid tier
}

/**
 * Return how many confirmed attempts remain in the current 12-hour window,
 * plus when the next slot opens if the limit is hit.
 * Returns null for paid tiers (unlimited).
 */
export async function getRemainingAttempts(
  userId: string | Types.ObjectId,
  planTier: string | null,
): Promise<RemainingAttemptsResult> {
  if (planTier && planTier !== FREE_TIER)
    return { remaining: null, nextAttemptAt: null };

  const uid = new Types.ObjectId(String(userId));
  const cutoff = windowStart();

  const doc = await QuizAttempt.findOne({ userId: uid });
  if (!doc) return { remaining: FREE_TIER_LIMIT, nextAttemptAt: null };

  const pendingCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const activeAttempts = doc.attempts.filter(
    (a) =>
      (a.status === "confirmed" && a.attemptedAt >= cutoff) ||
      (a.status === "pending" && a.attemptedAt >= pendingCutoff),
  );

  const remaining = Math.max(0, FREE_TIER_LIMIT - activeAttempts.length);

  let nextAttemptAt: Date | null = null;
  if (remaining === 0 && activeAttempts.length > 0) {
    const earliest = activeAttempts.reduce((min, a) =>
      a.attemptedAt < min.attemptedAt ? a : min,
    );
    nextAttemptAt = new Date(earliest.attemptedAt.getTime() + WINDOW_MS);
  }

  return { remaining, nextAttemptAt };
}

/**
 * Subscribes a guest student to exam countdown alerts, auto-enrolling their Contact
 * into UserCourseEnrollment and scheduling automated email alerts on shortQueue.
 */
export const createGuestExamReminder = async (
  data: ICreateGuestExamReminderInput,
) => {
  const email = data.email.toLowerCase().trim();
  const cleanStudentId = data.studentId
    ? data.studentId.trim().replace(/\D/g, "")
    : undefined;

  // 1. Upsert Contact in the newsletter lane with active status
  let contact = await Contact.findOne({ email });

  if (contact) {
    contact = await runInTransaction(async (session) => {
      contact!.isNewsletter = true;
      contact!.newsletterStatus = "active";
      contact!.confirmedAt = contact!.confirmedAt || new Date();
      contact!.source = "timetable_reminder";
      if (cleanStudentId && !contact!.studentId) {
        contact!.studentId = cleanStudentId;
      }
      if (data.name && !contact!.name) {
        contact!.name = data.name;
      }
      return await contact!.save({ session });
    });
  } else {
    contact = await runInTransaction(async (session) => {
      const newContact = new Contact({
        email,
        name: data.name,
        studentId: cleanStudentId,
        source: "timetable_reminder",
        isNewsletter: true,
        newsletterStatus: "active",
        confirmedAt: new Date(),
        subscribedAt: new Date(),
        unsubscribeToken: randomBytes(32).toString("hex"),
      });
      return await newContact.save({ session });
    });
  }

  const contactId = contact!._id as Types.ObjectId;
  const now = Date.now();
  const enrolledCourses: any[] = [];

  // 2. Fetch default published timetable context for semester / academicYear fallback
  const activeTimetable = await ExamTimetable.findOne({ isPublished: true })
    .sort({ createdAt: -1 })
    .lean();
  const fallbackSemester = normalizeSemester(activeTimetable?.semester || "Semester 2");
  const fallbackAcademicYear = normalizeAcademicYear(activeTimetable?.academicYear || "2025-2026");

  // 3. Enroll contact in UserCourseEnrollment for each course
  const papers = data.papers || [];
  for (const paper of papers) {
    try {
      const course = await upsertSystemCourse(
        paper.courseCode,
        paper.courseName,
        1,
      );
      const courseId = course._id as Types.ObjectId;

      const semester = normalizeSemester(paper.semester || fallbackSemester);
      const academicYear = normalizeAcademicYear(paper.academicYear || fallbackAcademicYear);

      const enrollment = await UserCourseEnrollment.findOneAndUpdate(
        {
          contactId,
          courseId,
          semester,
          academicYear,
        },
        {
          // Additive (mirrors enrollUserInCourse): re-activate an existing
          // enrollment without overwriting its identity fields or enrolledAt.
          $set: { status: "active" },
          $setOnInsert: {
            contactId,
            email,
            studentId: cleanStudentId,
            courseId,
            semester,
            academicYear,
            enrolledAt: new Date(),
          },
        },
        { upsert: true, returnDocument: "after" },
      );

      enrolledCourses.push(enrollment);
    } catch (err: any) {
      logger.error(
        `[GuestReminder] Error enrolling course ${paper.courseCode} for ${maskId(email)}: ${err.message}`,
      );
    }
  }

  // 4. Trigger existing canonical syncTimetableReminderJobs reconciler
  if (activeTimetable) {
    await syncTimetableReminderJobs(activeTimetable as any);
  }

  return { contact, enrolledCount: enrolledCourses.length };
};

