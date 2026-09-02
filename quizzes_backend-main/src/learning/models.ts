import mongoose, { Schema, model, Model } from "mongoose";
import { nanoid } from "nanoid";
import {
  IFlashcardSet,
  IMaterial,
  IPersonalQuiz,
  IProgress,
  IQuestion,
  IQuizQuestion,
  IQuiz,
  QuizStatus,
  IExamTimetable,
  IRecommendation,
  IMindMap,
  INote,
  IMaterialChunk,
  IUserCourseEnrollment,
  IQuizAttempt,
  ILibraryMaterial,
  ICourse,
} from "./interfaces";

const FlashcardCardSchema = new Schema(
  {
    cardId: {
      type: String,
      default: nanoid,
    },
    front: {
      type: String,
      required: true,
      trim: true,
    },
    back: {
      type: String,
      required: true,
      trim: true,
    },
    tags: {
      type: [String],
      default: [],
    },
    difficulty: {
      type: String,
      enum: ["easy", "medium", "hard"],
      default: "medium",
    },
    lastReviewed: {
      type: Date,
    },
    reviewCount: {
      type: Number,
      default: 0,
    },
    masteryLevel: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
  },
  { _id: false },
);

const FlashcardSetSchema = new Schema<IFlashcardSet>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    courseId: {
      type: Schema.Types.ObjectId,
      ref: "Course",
    },
    materialId: {
      type: Schema.Types.ObjectId,
      ref: "Material",
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    isPublic: {
      type: Boolean,
      default: false,
    },
    tags: {
      type: [String],
      default: [],
    },
    cards: {
      type: [FlashcardCardSchema],
      default: [],
      validate: {
        validator: (cards: unknown[]) => cards.length <= 50,
        message: "A flashcard set cannot exceed 50 cards",
      },
    },
    cardCount: {
      type: Number,
      default: 0,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
    },
  },
  { timestamps: true },
);

FlashcardSetSchema.pre("save", function () {
  if (this.isModified("cards")) {
    this.cardCount = this.cards.length;
    this.tags = [...new Set(this.cards.flatMap((c) => c.tags))];
  }
});

FlashcardSetSchema.index({ createdBy: 1, courseId: 1 });
FlashcardSetSchema.index({ courseId: 1 });
FlashcardSetSchema.index({ createdBy: 1, createdAt: -1 });
FlashcardSetSchema.index({ createdBy: 1, isDeleted: 1, createdAt: -1 });
FlashcardSetSchema.index({ "cards.tags": 1 });

export const FlashcardSet: Model<IFlashcardSet> = model<IFlashcardSet>(
  "FlashcardSet",
  FlashcardSetSchema,
);

const ParsedQuestionSchema = new Schema(
  {
    question: { type: String, required: true },
    options: { type: [String], default: [] },
    answer: { type: String, required: true },
    type: {
      type: String,
      enum: ["mcq", "true_false", "short_answer", "fill_in_blank"],
      required: true,
    },
    explanation: { type: String },
    hint: { type: String },
    difficulty: {
      type: String,
      enum: ["easy", "medium", "hard"],
      default: "medium",
    },
  },
  { _id: false },
);

const MaterialKnowledgeBlockSchema = new Schema(
  {
    blockId: { type: String, required: true },
    title: { type: String, required: true },
    summary: { type: String, required: true },
    pageReferences: { type: [Number], default: [] },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { _id: false },
);

const MaterialSummarySchema = new Schema(
  {
    overview: { type: String, required: true },
    logicalOverview: [
      {
        pillarNumber: { type: Number },
        title: { type: String },
        topics: { type: [String], default: [] },
        _id: false,
      },
    ],
    topicDeepDives: [
      {
        title: { type: String },
        description: { type: String },
        _id: false,
      },
    ],
    knowledgeBlocks: { type: [MaterialKnowledgeBlockSchema], default: [] },
    totalBlocks: { type: Number, default: 0 },
    generatedAt: { type: Date, default: Date.now },
    generatedBy: { type: String },
  },
  { _id: false },
);

const MaterialSchema: Schema<IMaterial> = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: "StudySession" },
    courseId: { type: Schema.Types.ObjectId, ref: "Course" },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    upload: { type: Schema.Types.ObjectId, ref: "Upload", required: true },
    filename: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    processingStatus: {
      type: String,
      enum: ["pending", "processing", "ready", "failed"],
      default: "pending",
    },
    contentType: {
      type: String,
      enum: ["material", "questions"],
      default: "material",
    },
    materialType: {
      type: String,
      enum: [
        "syllabus",
        "test_examples",
        "course_context",
        "learning_material",
      ],
      default: "learning_material",
    },
    summary: { type: MaterialSummarySchema },
    extractedText: { type: String },
    chunkCount: { type: Number, default: 0 },
    wordCount: { type: Number, default: 0 },
    pageCount: { type: Number, default: 0 },
    failureReason: { type: String },
    uploadedAt: { type: Date, default: Date.now },
    processedAt: { type: Date },
    isImported: { type: Boolean, default: false },
    sourceLibraryId: { type: Schema.Types.ObjectId, ref: "LibraryMaterial" },
    parsedQuestions: { type: [ParsedQuestionSchema], default: undefined },
    quizGenerated: { type: Boolean, default: false },
    quizGeneratedAt: { type: Date },
    flashcardsGenerated: { type: Boolean, default: false },
    flashcardsGeneratedAt: { type: Date },
  },
  { collection: "materials", timestamps: true },
);

MaterialSchema.index({ sessionId: 1 });
MaterialSchema.index({ sessionId: 1, processingStatus: 1 });

export const Material: Model<IMaterial> = model<IMaterial>(
  "Material",
  MaterialSchema,
);

// ---------------------------------------------------------------------------
// Quiz hierarchy sub-schemas (shared between QuizSchema and PersonalQuizSchema)
// ---------------------------------------------------------------------------

const QuizQuestionGroupSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["mcq", "true_false", "short_answer", "essay", "fill_in_blank"],
      required: true,
    },
    instructions: { type: String },
    questions: [{ type: Schema.Types.ObjectId, ref: "Question" }],
  },
  { _id: false },
);

const QuizTopicSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    order: { type: Number, required: true, default: 0 },
    questionTypes: [QuizQuestionGroupSchema],
  },
  { _id: false },
);

const QuizLectureSchema = new Schema(
  {
    lectureId: { type: Schema.Types.ObjectId, ref: "Material" },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    order: { type: Number, required: true, default: 0 },
    topics: [QuizTopicSchema],
  },
  { _id: false },
);

// ---------------------------------------------------------------------------
// IQuiz — course-level quiz created by Qz team / admin
// ---------------------------------------------------------------------------

const QuizSettingsSchema = new Schema(
  {
    timeLimit: { type: Number, min: 0 },
    shuffleQuestions: { type: Boolean, default: true },
    showHints: { type: Boolean, default: true },
    showExplanations: { type: Boolean, default: true },
  },
  { _id: false },
);

const QUIZ_STATUSES: QuizStatus[] = ["draft", "published", "archived"];

const QuizSchema = new Schema<IQuiz>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    status: {
      type: String,
      enum: QUIZ_STATUSES,
      default: "draft",
      required: true,
    },
    isAvailable: { type: Boolean, default: false },
    availableFrom: { type: Date },
    availableTo: { type: Date },
    passingScore: { type: Number, default: 70, min: 0, max: 100 },
    settings: { type: QuizSettingsSchema, default: () => ({}) },
    tags: { type: [String], default: [] },
    lectures: [QuizLectureSchema],
  },
  { timestamps: true },
);

QuizSchema.index({ courseId: 1 });
QuizSchema.index({ status: 1, isAvailable: 1 });
QuizSchema.index({ tags: 1 });

export const Quiz: Model<IQuiz> = model<IQuiz>("Quiz", QuizSchema);

// ---------------------------------------------------------------------------
// IPersonalQuiz — AI-generated, user-owned quiz
// ---------------------------------------------------------------------------

const AIGenerationTaskSchema = new Schema(
  {
    taskId: { type: String, required: true },
    label: { type: String, required: true },
    lectureTitle: { type: String, required: true },
    topicTitle: { type: String, required: true },
    questionType: { type: String, required: true },
    questionCount: { type: Number, required: true },
    status: {
      type: String,
      enum: ["pending", "in_progress", "completed", "failed"],
      default: "pending",
    },
    startedAt: { type: Date },
    completedAt: { type: Date },
    errorMessage: { type: String },
  },
  { _id: false },
);

const AIGenerationPlanSchema = new Schema(
  {
    plan: [
      {
        lectureTitle: { type: String, required: true },
        topics: [
          {
            title: { type: String, required: true },
            questionTypes: [
              {
                type: { type: String, required: true },
                count: { type: Number, required: true },
              },
            ],
            totalQuestions: { type: Number, required: true },
          },
        ],
        totalQuestions: { type: Number, required: true },
        estimatedDuration: { type: String, required: true },
      },
    ],
    planGeneratedAt: { type: Date, required: true },
    approvedByUser: { type: Boolean, default: false },
    approvedAt: { type: Date },
    tasks: [AIGenerationTaskSchema],
    generationStatus: {
      type: String,
      enum: [
        "planning",
        "awaiting_approval",
        "generating",
        "completed",
        "failed",
      ],
      default: "planning",
    },
    generationStartedAt: { type: Date },
    generationCompletedAt: { type: Date },
    totalTasks: { type: Number, default: 0 },
    completedTasks: { type: Number, default: 0 },
    failedTasks: { type: Number, default: 0 },
  },
  { _id: false },
);

const PersonalQuizSchema = new Schema<IPersonalQuiz>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    materialId: { type: Schema.Types.ObjectId, ref: "Material" },
    courseId: { type: Schema.Types.ObjectId, ref: "Course", required: false },
    universityId: { type: Schema.Types.ObjectId, ref: "University" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    lectures: [QuizLectureSchema],
    settings: {
      timeLimit: { type: Number, min: 0 },
      shuffleQuestions: { type: Boolean, default: true },
      showHints: { type: Boolean, default: true },
      showExplanations: { type: Boolean, default: true },
      allowRetakes: { type: Boolean, default: true },
      passingScore: { type: Number, min: 0, max: 100, default: 70 },
    },
    stats: {
      totalAttempts: { type: Number, default: 0 },
      averageScore: { type: Number, default: 0 },
      bestScore: { type: Number, default: 0 },
      lastAttempted: { type: Date },
    },
    aiGenerationPlan: { type: AIGenerationPlanSchema },
    isPublic: { type: Boolean, default: false },
    tags: [{ type: String, trim: true }],
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

PersonalQuizSchema.index({ courseId: 1, createdBy: 1 });
PersonalQuizSchema.index({ createdBy: 1, courseId: 1 }); // user-first lookup
PersonalQuizSchema.index({ createdBy: 1, isPublic: 1 });
PersonalQuizSchema.index({ createdBy: 1, isDeleted: 1, createdAt: -1 });
PersonalQuizSchema.index({ tags: 1 });
PersonalQuizSchema.index({
  courseId: 1,
  "aiGenerationPlan.generationStatus": 1,
});

export const PersonalQuiz = mongoose.model<IPersonalQuiz>(
  "PersonalQuiz",
  PersonalQuizSchema,
);

const MindMapNodeSchema = new Schema(
  {
    id: { type: String, required: true },
    label: { type: String, required: true },
    type: {
      type: String,
      enum: ["concept", "topic", "detail", "question"],
      required: true,
    },
    position: {
      x: { type: Number, required: true },
      y: { type: Number, required: true },
    },
  },
  { _id: false },
);

const MindMapEdgeSchema = new Schema(
  {
    id: { type: String, required: true },
    source: { type: String, required: true },
    target: { type: String, required: true },
    label: { type: String },
  },
  { _id: false },
);

const MindMapSchema = new Schema<IMindMap>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true, trim: true },
    courseId: { type: Schema.Types.ObjectId, ref: "Course" },
    sourceSessionId: { type: String },
    sourceArtifactId: { type: String },
    nodes: { type: [MindMapNodeSchema], default: [] },
    edges: { type: [MindMapEdgeSchema], default: [] },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

MindMapSchema.index({ userId: 1, updatedAt: -1 });
MindMapSchema.index({ userId: 1, isDeleted: 1, updatedAt: -1 });
MindMapSchema.index({
  userId: 1,
  sourceSessionId: 1,
  sourceArtifactId: 1,
});

export const MindMap: Model<IMindMap> = model<IMindMap>(
  "MindMap",
  MindMapSchema,
);

const NoteSchema = new Schema<INote>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    sessionId: { type: String, required: true },
    sourceNoteId: { type: String, required: true },
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    generatedByZ: { type: Boolean, default: true },
    sessionName: { type: String },
    courseTitle: { type: String },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

NoteSchema.index({ userId: 1, updatedAt: -1 });
NoteSchema.index({ userId: 1, isDeleted: 1, updatedAt: -1 });
NoteSchema.index(
  { userId: 1, sessionId: 1, sourceNoteId: 1 },
  { unique: true },
);

export const Note: Model<INote> = model<INote>("Note", NoteSchema);

const ProgressSchema = new Schema<IProgress>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    lectureProgress: [
      {
        name: {
          type: String,
          required: true,
        },
        completed: {
          type: Number,
          default: 0,
        },
        total: {
          type: Number,
        },
        date: {
          type: Date,
          default: new Date(),
        },
      },
    ],
    courseId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "Course",
    },
    quizId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "Quizzes",
    },
  },
  {
    timestamps: true,
  },
);

export const Progress: Model<IProgress> = model<IProgress>(
  "Progress",
  ProgressSchema,
);

const QuestionSchema = new Schema<IQuestion>(
  {
    courseId: {
      type: Schema.Types.ObjectId,
      required: false,
      ref: "Course",
    },
    question: {
      type: String,
      required: true,
    },
    options: {
      type: [String],
      required: true,
    },
    answer: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ["mcq", "true_false", "short_answer", "essay", "fill_in_blank"],
      required: true,
    },
    explanation: {
      type: String,
    },
    lectureNumber: {
      type: String,
    },
    hint: {
      type: String,
    },
    author: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    isModerated: {
      type: Boolean,
      default: false,
    },
    moderatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    year: {
      type: Number,
      default: new Date().getFullYear(),
    },
    aiGeneratedExplanation: {
      type: String,
    },
    aiConfidenceScore: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

QuestionSchema.index({ courseId: 1, isModerated: 1 });

export const Question: Model<IQuestion> = model<IQuestion>(
  "Question",
  QuestionSchema,
);

const QuizQuestionSchema = new Schema<IQuizQuestion>(
  {
    courseId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "Course",
      unique: true,
    },
    name: {
      type: String,
      required: true,
    },
    isApproved: {
      type: Boolean,
      default: false,
    },
    quizQuestions: [
      {
        name: {
          type: String,
          required: true,
        },
        questions: [
          {
            type: Schema.Types.ObjectId,
            ref: "Question",
            required: true,
          },
        ],
      },
    ],
    creditHours: {
      type: Number,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

export const QuizQuestion: Model<IQuizQuestion> = model<IQuizQuestion>(
  "Quizzes",
  QuizQuestionSchema,
);

// ---------------------------------------------------------------------------
// IExamTimetable
// ---------------------------------------------------------------------------

const VenueMappingSchema = new Schema(
  {
    venue: { type: String, required: true, trim: true },
    indexStart: { type: String },
    indexEnd: { type: String },
  },
  { _id: false },
);

const ExamSessionSchema = new Schema(
  {
    sessionId: { type: String, required: true },
    label: { type: String, trim: true },
    scheduledAt: { type: Date, required: true },
    venues: [VenueMappingSchema],
    durationMinutes: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const ExamEntrySchema = new Schema(
  {
    courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true },
    courseName: { type: String, required: true, trim: true },
    courseCode: { type: String, required: true, trim: true },
    examType: {
      type: String,
      enum: ["midterm", "final", "resit", "supplementary"],
      required: true,
    },
    sessions: [ExamSessionSchema],
    semester: { type: String, required: true },
    academicYear: { type: String, required: true },
    invigilators: [{ type: Schema.Types.ObjectId, ref: "User" }],
    isPublished: { type: Boolean, default: false },
    isAutoSynced: { type: Boolean, default: false },
  },
  { _id: true },
);

const ExamTimetableSchema = new Schema<IExamTimetable>(
  {
    semester: { type: String, required: true },
    academicYear: { type: String, required: true },
    isPublished: { type: Boolean, default: false },
    publishedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    entries: [ExamEntrySchema],
  },
  { timestamps: true },
);

ExamTimetableSchema.index({ semester: 1, academicYear: 1, isPublished: 1 });
ExamTimetableSchema.index({ isPublished: 1, semester: 1, academicYear: 1 });
ExamTimetableSchema.index({ "entries.courseId": 1 });
ExamTimetableSchema.index({ "entries.courseCode": 1 });
ExamTimetableSchema.index({ "entries.sessions.scheduledAt": 1 });

export const ExamTimetable: Model<IExamTimetable> = model<IExamTimetable>(
  "ExamTimetable",
  ExamTimetableSchema,
);

// ---------------------------------------------------------------------------
// IRecommendation
// ---------------------------------------------------------------------------

const RecommendationSchema = new Schema<IRecommendation>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    contentType: {
      type: String,
      enum: [
        "quiz",
        "material",
        "course",
        "flashcard_set",
        "study_partner",
        "video",
        "note",
        "mind_map",
      ],
      required: true,
    },
    contentId: { type: Schema.Types.ObjectId, required: true },
    reason: {
      type: String,
      enum: [
        "ai_suggested",
        "trending",
        "peer_activity",
        "completion_gap",
        "exam_prep",
        "identified_weakness",
      ],
      required: true,
    },
    relevanceScore: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      default: 0.5,
    },
    rationale: { type: String, trim: true },
    dismissed: { type: Boolean, default: false },
    dismissedAt: { type: Date },
    clicked: { type: Boolean, default: false },
    clickedAt: { type: Date },
    expiresAt: { type: Date },
  },
  { timestamps: true },
);

// Compound index: one active recommendation per (user, content) pair
RecommendationSchema.index(
  { userId: 1, contentType: 1, contentId: 1 },
  { unique: true },
);
RecommendationSchema.index({ userId: 1, dismissed: 1, expiresAt: 1 });
RecommendationSchema.index({ universityId: 1, contentType: 1 });
// TTL index — auto-delete expired recommendations
RecommendationSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, sparse: true },
);

export const Recommendation: Model<IRecommendation> = model<IRecommendation>(
  "Recommendation",
  RecommendationSchema,
);

// ---------------------------------------------------------------------------
// IUserCourseEnrollment
// ---------------------------------------------------------------------------

const UserCourseEnrollmentSchema = new Schema<IUserCourseEnrollment>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    contactId: {
      type: Schema.Types.ObjectId,
      ref: "Contact",
      index: true,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      index: true,
    },
    studentId: {
      type: String,
      trim: true,
      index: true,
    },
    courseId: {
      type: Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },
    semester: { type: String, required: true },
    academicYear: { type: String, required: true },
    status: {
      type: String,
      enum: ["active", "dropped", "completed"],
      default: "active",
    },
    enrolledAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// Compound indexes
UserCourseEnrollmentSchema.index(
  { userId: 1, courseId: 1, semester: 1, academicYear: 1 },
  { unique: true, sparse: true },
);
UserCourseEnrollmentSchema.index(
  { contactId: 1, courseId: 1, semester: 1, academicYear: 1 },
  { unique: true, sparse: true },
);
UserCourseEnrollmentSchema.index(
  { email: 1, courseId: 1, semester: 1, academicYear: 1 },
  { sparse: true },
);

export const UserCourseEnrollment: Model<IUserCourseEnrollment> =
  model<IUserCourseEnrollment>(
    "UserCourseEnrollment",
    UserCourseEnrollmentSchema,
  );

const CourseSchema = new Schema<ICourse>(
  {
    code: {
      type: String,
      unique: true,
      required: true,
      default: function (this: any) {
        if (this.isCustom) {
          const prefix = (this.title || "COURSE")
            .replace(/[^a-zA-Z0-9]/g, "")
            .toUpperCase()
            .slice(0, 6);
          return `CUSTOM-${prefix}-${nanoid(4).toUpperCase()}`;
        }
        return nanoid();
      },
    },
    title: { type: String, required: true },
    about: { type: String, required: true },
    isCustom: { type: Boolean, default: false },
    sources: [{ type: Schema.Types.ObjectId, ref: "Material" }],
    numberOfLectures: { type: Number, required: false },
    approvedQuestionsCount: { type: Number, required: true, default: 0 },
    semester: { type: Number, default: 1 },
    creditHours: { type: Number, default: 3 },
    year: { type: Number, default: new Date().getFullYear() },
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isShared: { type: Boolean, default: false },
    sharedAcrossSchools: { type: Boolean, default: false, required: false },
    tags: { type: [String], default: [] },
    programIds: { type: [Schema.Types.ObjectId], default: [] },
    credits: { type: Number, required: false },
    courseCode: { type: String, required: false },
    prerequisites: { type: [Schema.Types.ObjectId], default: [] },
  },
  { timestamps: true },
);

CourseSchema.index({ createdBy: 1, isCustom: 1 });

export const Course: Model<ICourse> = model<ICourse>("Course", CourseSchema);

const MaterialChunkSchema = new Schema(
  {
    chunkId: { type: String, default: nanoid },
    materialId: {
      type: Schema.Types.ObjectId,
      ref: "Material",
      required: true,
    },
    sessionId: { type: String },
    text: { type: String, required: true },
    embedding: { type: [Number], default: [] },
    section: { type: String },
    pageNumber: { type: Number },
    tokenCount: { type: Number, default: 0 },
  },
  { collection: "materialchunks" },
);

MaterialChunkSchema.index({ sessionId: 1 });
MaterialChunkSchema.index({ materialId: 1 });

export const MaterialChunk = model<IMaterialChunk>(
  "MaterialChunk",
  MaterialChunkSchema,
);

// ---------------------------------------------------------------------------
// LibraryMaterial — admin-curated or user-submitted public materials
// ---------------------------------------------------------------------------

const LibraryMaterialSchema = new Schema<ILibraryMaterial>(
  {
    materialId: {
      type: Schema.Types.ObjectId,
      ref: "Material",
      required: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    universityId: { type: Schema.Types.ObjectId, ref: "University" },
    courseId: { type: Schema.Types.ObjectId, ref: "Course" },
    subject: { type: String, trim: true },
    year: { type: Number },
    tags: { type: [String], default: [] },
    submittedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: {
      type: String,
      enum: ["pending_review", "published", "rejected"],
      default: "pending_review",
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
    publishedAt: { type: Date },
    rejectionReason: { type: String, trim: true },
    useCount: { type: Number, default: 0 },
    quizGenerated: { type: Boolean, default: false },
    quizGeneratedAt: { type: Date },
  },
  { timestamps: true },
);

LibraryMaterialSchema.index({ status: 1, createdAt: -1 });
LibraryMaterialSchema.index({ status: 1, universityId: 1 });
LibraryMaterialSchema.index({ status: 1, courseId: 1 });
LibraryMaterialSchema.index({ tags: 1 });
LibraryMaterialSchema.index({ submittedBy: 1 });

export const LibraryMaterial = model<ILibraryMaterial>(
  "LibraryMaterial",
  LibraryMaterialSchema,
);

// ---------------------------------------------------------------------------
// QuizAttempt — one document per user, rolling 12-hour attempt tracking
// ---------------------------------------------------------------------------

const QuizAttemptEntrySchema = new Schema(
  {
    quizId: { type: Schema.Types.ObjectId, ref: "Quiz", required: true },
    status: {
      type: String,
      enum: ["pending", "confirmed"],
      default: "pending",
    },
    attemptedAt: { type: Date, required: true, default: () => new Date() },
  },
  { _id: false },
);

const QuizAttemptSchema = new Schema<IQuizAttempt>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    attempts: { type: [QuizAttemptEntrySchema], default: [] },
  },
  { timestamps: false },
);

export const QuizAttempt = model<IQuizAttempt>(
  "QuizAttempt",
  QuizAttemptSchema,
);
