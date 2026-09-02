import { Schema, model, Model } from "mongoose";
import { nanoid } from "nanoid";
import {
  IStudySession,
  ISessionMemory,
  IStudyPlan,
  ICourseSummary,
  ITask,
} from "./interfaces";

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const CitationSchema = new Schema(
  {
    citationId: { type: String, default: nanoid },
    marker: { type: String, required: true },
    materialId: { type: String, required: true },
    filename: { type: String, required: true },
    excerpt: { type: String, required: true },
    pageNumber: { type: Number },
    messageId: { type: String, required: true },
  },
  { _id: false },
);

const GoalSchema = new Schema(
  {
    goalId: { type: String, default: nanoid },
    title: { type: String, required: true },
    description: { type: String },
    status: {
      type: String,
      enum: ["pending", "active", "completed", "skipped"],
      default: "pending",
    },
    artifactIds: { type: [String], default: [] },
    startedAt: { type: Date },
    completedAt: { type: Date },
    miniWalkthroughId: { type: String },
  },
  { _id: false },
);

const MessageSchema = new Schema(
  {
    messageId: { type: String, default: nanoid },
    role: { type: String, enum: ["user", "z", "system", "peer"], required: true },
    authorId: { type: String },
    authorName: { type: String },
    content: { type: String, required: true },
    type: {
      type: String,
      enum: [
        "text",
        "artifact",
        "tool_call",
        "tool_result",
        "steering",
        "directive",
        "system_action",
      ],
      default: "text",
    },
    artifactId: { type: String },
    artifact: { type: Schema.Types.Mixed },
    toolCall: { type: Schema.Types.Mixed },
    toolResult: { type: Schema.Types.Mixed },
    directive: { type: Schema.Types.Mixed },
    citations: { type: Schema.Types.Mixed },
    phase: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    isStreaming: { type: Boolean, default: false },
    replyToMessageId: { type: String },
    rating: { type: Number, enum: [1, -1] },
  },
  { _id: false },
);

const KnowledgeBlockSchema = new Schema(
  {
    blockId: { type: String, default: nanoid },
    title: { type: String, required: true },
    summary: { type: String },
    materialId: { type: String },
    sourceChunkIds: { type: [String], default: [] },
    completed: { type: Boolean, default: false },
    completedAt: { type: Date },
    order: { type: Number, default: 0 },
  },
  { _id: false },
);

const ChapterGoalSchema = new Schema(
  {
    goalId: { type: String, default: nanoid },
    title: { type: String, required: true },
    description: { type: String },
    status: {
      type: String,
      enum: ["pending", "active", "completed", "skipped"],
      default: "pending",
    },
    targetBlockIds: { type: [String], default: [] },
    completedAt: { type: Date },
  },
  { _id: false },
);

const StudyStepSchema = new Schema(
  {
    stepId: { type: String, default: nanoid },
    topicId: { type: String },
    label: { type: String, default: "" },
    order: { type: Number, default: 0 },
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    coreIdea: { type: String, default: "" },
    whyItMatters: { type: String, default: "" },
    prerequisites: { type: [KnowledgeBlockSchema], default: [] },
    goals: { type: [ChapterGoalSchema], default: [] },
    completedBlocks: { type: Number, default: 0 },
    totalBlocks: { type: Number, default: 0 },
    isCompleted: { type: Boolean, default: false },
  },
  { _id: false },
);

const StudyChapterSchema = new Schema(
  {
    chapterId: { type: String, default: nanoid },
    number: { type: Number, required: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    isRecommended: { type: Boolean, default: false },
    goals: { type: [ChapterGoalSchema], default: [] },
    steps: { type: [StudyStepSchema], default: [] },
    completedBlocks: { type: Number, default: 0 },
    totalBlocks: { type: Number, default: 0 },
  },
  { _id: false },
);

const ArtifactSchema = new Schema(
  {
    artifactId: { type: String, default: nanoid },
    type: {
      type: String,
      enum: [
        "study_plan",
        "directive",
        "lesson",
        "flashcard_set",
        "quiz",
        "mindmap",
        "notes",
        "verification",
        "walkthrough",
        "mini_walkthrough",
        "recap",
        "exposition",
        "question",
        "summary",
      ],
      required: true,
    },
    title: { type: String, required: true },
    content: { type: Schema.Types.Mixed, required: true },
    phase: { type: String, required: true },
    goalId: { type: String },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const InterruptStateSchema = new Schema(
  {
    interruptedAt: { type: Date, required: true },
    interruptReason: { type: String, required: true },
    resumeFrom: { type: String, required: true },
    pendingInstruction: { type: String, required: true },
  },
  { _id: false },
);

const StudioSchema = new Schema(
  {
    savedFlashcardSetIds: { type: [String], default: [] },
    savedQuizIds: { type: [String], default: [] },
    savedFlashcardArtifactIds: { type: [String], default: [] },
    savedQuizArtifactIds: { type: [String], default: [] },
    sharedNotes: {
      type: [
        {
          id: { type: String, default: nanoid },
          content: { type: String, required: true },
          authorId: { type: String, required: true },
          authorName: { type: String, required: true },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
      _id: false,
    },
    exportedFiles: {
      type: [
        {
          exportId: { type: String, default: nanoid },
          type: { type: String, enum: ["pdf", "markdown"] },
          url: { type: String },
          generatedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
      _id: false,
    },
    mindMap: { type: Schema.Types.Mixed },
  },
  { _id: false },
);

const HighlightSchema = new Schema(
  {
    id: { type: String, default: nanoid },
    materialId: { type: String, required: true },
    pageNumber: { type: Number, required: true },
    text: { type: String, required: true },
    note: { type: String },
    color: { type: String },
    bounds: {
      top: { type: Number, required: true },
      left: { type: Number, required: true },
      width: { type: Number, required: true },
      height: { type: Number, required: true },
    },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

// ─── Main schema ──────────────────────────────────────────────────────────────

const StudySessionSchema = new Schema<IStudySession>(
  {
    name: { type: String, default: "New Study Session" },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    courseId: { type: Schema.Types.ObjectId, ref: "Course" },
    mode: { type: String, enum: ["free", "structured"], default: "structured" },
    planningMode: {
      type: String,
      enum: ["planning", "fast"],
      default: "planning",
    },
    status: {
      type: String,
      enum: ["active", "paused", "completed", "abandoned"],
      default: "active",
    },
    currentPhase: { type: String, default: "idle" },
    previousPhase: { type: String },

    // Active navigation pointer
    activeChapterId: { type: String },
    activeStepId: { type: String },
    activeBlockId: { type: String },
    activeChapterGoalId: { type: String },

    // Quick-access mastery tracking
    completedBlockIds: { type: [String], default: [] },
    totalBlocks: { type: Number, default: 0 },
    completedBlocks: { type: Number, default: 0 },

    // Linked session study plan
    studyPlan: { type: Schema.Types.ObjectId, ref: "StudyPlan" },

    // Linked session course summary
    courseSummary: { type: Schema.Types.ObjectId, ref: "CourseSummary" },

    goals: { type: [GoalSchema], default: [] },
    currentGoalId: { type: String },
    materialIds: [{ type: Schema.Types.ObjectId, ref: "Material" }],
    isTransient: { type: Boolean, default: false },
    artifacts: { type: [ArtifactSchema], default: [] },
    messages: { type: [MessageSchema], default: [] },
    citations: { type: [CitationSchema], default: [] },
    highlights: { type: [HighlightSchema], default: [] },
    equippedSkills: { type: [String], default: [] },
    memorySnapshot: { type: Schema.Types.Mixed },
    studio: { type: StudioSchema, default: () => ({}) },
    startedAt: { type: Date },
    completedAt: { type: Date },
    durationMinutes: { type: Number },
    interruptState: { type: InterruptStateSchema },
    peers: {
      type: [
        {
          id: { type: Schema.Types.ObjectId, ref: "User", required: true },
          joinedAt: { type: Date },
        },
      ],
      default: [],
      _id: false,
    },
  },
  { timestamps: true },
);

StudySessionSchema.index({ userId: 1, status: 1 });
StudySessionSchema.index({ userId: 1, createdAt: -1 });
StudySessionSchema.index({ courseId: 1, userId: 1 });
StudySessionSchema.index({ "goals.status": 1 });
StudySessionSchema.index({ currentPhase: 1 });

export const StudySession = model<IStudySession>(
  "StudySession",
  StudySessionSchema,
);

// ─── Study Plan Model ─────────────────────────────────────────────────────────

const StudyPlanSchema = new Schema<IStudyPlan>(
  {
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: "StudySession",
      required: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    courseId: { type: Schema.Types.ObjectId, ref: "Course" },
    goal: { type: String, required: true },
    chapters: { type: [StudyChapterSchema], default: [] },
    totalChapters: { type: Number, default: 0 },
    totalBlocks: { type: Number, default: 0 },
    completedBlocks: { type: Number, default: 0 },
    estimatedMinutes: { type: Number, default: 30 },
    approvedAt: { type: Date },
    editedByUser: { type: Boolean, default: false },
  },
  { timestamps: true },
);

StudyPlanSchema.index({ sessionId: 1 }, { unique: true });
StudyPlanSchema.index({ userId: 1 });
StudyPlanSchema.index({ courseId: 1 });

export const StudyPlan = model<IStudyPlan>("StudyPlan", StudyPlanSchema);

// ─── Course Summary Model ───────────────────────────────────────────────────

const CourseSummaryLogicalPillarSchema = new Schema(
  {
    pillarNumber: { type: Number, required: true },
    title: { type: String, required: true },
    topics: { type: [String], default: [] },
  },
  { _id: false },
);

const CourseSummaryTopicDeepDiveSchema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: "" },
  },
  { _id: false },
);

const CourseSummarySectionSchema = new Schema(
  {
    title: { type: String, required: true },
    body: { type: String, default: "" },
  },
  { _id: false },
);

const CourseSummarySchema = new Schema<ICourseSummary>(
  {
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: "StudySession",
      required: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    courseId: { type: Schema.Types.ObjectId, ref: "Course" },
    title: { type: String, default: "Course Summary" },
    overview: { type: String, default: "" },
    logicalPillars: { type: [CourseSummaryLogicalPillarSchema], default: [] },
    topicDeepDives: { type: [CourseSummaryTopicDeepDiveSchema], default: [] },
    keyTakeaways: { type: [String], default: [] },
    sections: { type: [CourseSummarySectionSchema], default: [] },
  },
  { timestamps: true },
);

CourseSummarySchema.index({ sessionId: 1 }, { unique: true });
CourseSummarySchema.index({ userId: 1 });
CourseSummarySchema.index({ courseId: 1 });

export const CourseSummary = model<ICourseSummary>(
  "CourseSummary",
  CourseSummarySchema,
);


// ─── Memory schema ────────────────────────────────────────────────────────────

const SessionMemorySchema = new Schema<ISessionMemory>(
  {
    userId: { type: String, required: true },
    courseId: { type: String },
    knownConcepts: { type: [String], default: [] },
    gaps: { type: [String], default: [] },
    masteredGoals: { type: [String], default: [] },
    studyPatterns: {
      preferredMode: {
        type: String,
        enum: ["planning", "fast"],
        default: "planning",
      },
      averageSessionMins: { type: Number, default: 0 },
      strongTopics: { type: [String], default: [] },
      weakTopics: { type: [String], default: [] },
    },
    lastUpdatedAt: { type: Date, default: Date.now },
    lastSessionId: { type: String },
  },
  { timestamps: true },
);

SessionMemorySchema.index({ userId: 1, courseId: 1 }, { unique: true });
SessionMemorySchema.index({ userId: 1 });

export const SessionMemory = model<ISessionMemory>(
  "SessionMemory",
  SessionMemorySchema,
);

// ─── Study task ───────────────────────────────────────────────────────────────

const TaskSchema = new Schema<ITask>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true, trim: true },
    subject: { type: String, trim: true },
    status: {
      type: String,
      enum: ["active", "completed"],
      default: "active",
    },
    completedAt: { type: Date },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

TaskSchema.index({ userId: 1, status: 1 });
TaskSchema.index({ userId: 1, createdAt: -1 });

export const Task = model<ITask>("Task", TaskSchema);
