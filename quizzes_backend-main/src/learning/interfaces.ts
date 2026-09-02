import { Document, Types } from "mongoose";
import { IUpload } from "@/system";

// ---------------------------------------------------------------------------
// Flashcard
// ---------------------------------------------------------------------------

/** A single card embedded inside an IFlashcardSet. Not a Mongoose Document. */
export interface IFlashcardCard {
  cardId: string;
  front: string;
  back: string;
  tags: string[];
  difficulty: "easy" | "medium" | "hard";
  lastReviewed?: Date;
  reviewCount: number;
  masteryLevel: number; // 0-100
}

export interface IFlashcardSet extends Document {
  _id: Types.ObjectId;
  title: string;
  description?: string;
  courseId: Types.ObjectId;
  materialId?: Types.ObjectId;
  createdBy: Types.ObjectId;
  isPublic: boolean;
  /** Union of all card tags, recomputed on save. */
  tags: string[];
  cards: IFlashcardCard[];
  /** Denormalized card count, recomputed on save. */
  cardCount: number;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IMindMapNode {
  id: string;
  label: string;
  type: "concept" | "topic" | "detail" | "question";
  position: { x: number; y: number };
}

export interface IMindMapEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface IMindMap extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  title: string;
  courseId?: Types.ObjectId;
  sourceSessionId?: string;
  sourceArtifactId?: string;
  nodes: IMindMapNode[];
  edges: IMindMapEdge[];
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface INote extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  sessionId: string;
  sourceNoteId: string;
  title: string;
  content: string;
  generatedByZ: boolean;
  sessionName?: string;
  courseTitle?: string;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------

export type MaterialType =
  | "syllabus"
  | "test_examples"
  | "course_context"
  | "learning_material";

export interface IMaterialKnowledgeBlock {
  blockId: string;
  title: string;
  summary: string;
  pageReferences?: number[];
  isActive: boolean;
  order: number;
}

export interface IMaterialSummary {
  overview: string;
  logicalOverview?: {
    pillarNumber: number;
    title: string;
    topics: string[];
  }[];
  topicDeepDives?: {
    title: string;
    description: string;
  }[];
  knowledgeBlocks: IMaterialKnowledgeBlock[];
  totalBlocks: number;
  generatedAt: Date;
  generatedBy: string;
}

export interface IParsedQuestion {
  question: string;
  options: string[];
  answer: string;
  type: "mcq" | "true_false" | "short_answer" | "fill_in_blank";
  explanation?: string;
  hint?: string;
  difficulty: "easy" | "medium" | "hard";
}

export interface IMaterial extends Document {
  sessionId?: Types.ObjectId;
  courseId?: Types.ObjectId;
  uploadedBy: Types.ObjectId;
  upload: Types.ObjectId; // Reference to Upload document
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  processingStatus: "pending" | "processing" | "ready" | "failed";
  /** Whether the file is a study document or a pre-existing question/exam paper. */
  contentType: "material" | "questions";
  /** Categorized functional material type */
  materialType?: MaterialType;
  /** AI-generated summary with pre-extracted knowledge blocks and pillars */
  summary?: IMaterialSummary;
  extractedText?: string;
  chunkCount: number;
  wordCount: number;
  pageCount: number;
  failureReason?: string;
  uploadedAt: Date;
  processedAt?: Date;
  isImported?: boolean;
  sourceLibraryId?: Types.ObjectId;
  /** Questions parsed directly from an uploaded question/exam paper. */
  parsedQuestions?: IParsedQuestion[];
  quizGenerated: boolean;
  quizGeneratedAt?: Date;
  flashcardsGenerated: boolean;
  flashcardsGeneratedAt?: Date;
}

export interface IMaterialChunk {
  chunkId: string;
  materialId: Types.ObjectId | string;
  sessionId?: string;
  text: string;
  embedding: number[];
  section?: string;
  pageNumber?: number;
  tokenCount: number;
}

export interface MaterialSearchResult {
  chunkId: string;
  materialId: string;
  filename: string;
  text: string;
  section?: string;
  pageNumber?: number;
  score: number;
}

export interface TextChunk {
  text: string;
  section?: string;
  pageNumber?: number;
}

// ---------------------------------------------------------------------------
// Question
// ---------------------------------------------------------------------------

export interface IQuestion extends Document {
  _id: Types.ObjectId;
  courseId: Types.ObjectId;
  question: string;
  options: string[];
  answer: string;
  type: "mcq" | "true_false" | "short_answer" | "essay" | "fill_in_blank";
  explanation?: string;
  lectureNumber?: string;
  hint?: string;
  author: Types.ObjectId;
  isModerated: boolean;
  moderatedBy: Types.ObjectId;
  year: number;
  aiGeneratedExplanation: string;
  aiConfidenceScore: number;
}

// ---------------------------------------------------------------------------
// Quiz hierarchy — shared sub-types
// ---------------------------------------------------------------------------

/**
 * A group of questions of a single type inside a topic.
 * Questions are stored as ObjectId refs to IQuestion.
 */
export interface IQuizQuestionGroup {
  type: "mcq" | "true_false" | "short_answer" | "essay" | "fill_in_blank";
  instructions?: string;
  /** Refs to IQuestion documents */
  questions: Types.ObjectId[];
}

/**
 * A topic inside a lecture — wraps one or more question groups.
 * Index recommendation: no top-level index needed (embedded sub-array).
 */
export interface IQuizTopic {
  title: string;
  description: string;
  order: number;
  questionTypes: IQuizQuestionGroup[];
}

/**
 * A lecture section inside a quiz.
 * Index recommendation: no top-level index needed (embedded sub-array).
 */
export interface IQuizLecture {
  /** Ref to a course lecture / material document */
  lectureId: Types.ObjectId;
  title: string;
  description: string;
  order: number;
  topics: IQuizTopic[];
}

// ---------------------------------------------------------------------------
// AI Generation Plan — used by IPersonalQuiz and IStudyPartnerSession
// ---------------------------------------------------------------------------

export interface IAIGenerationPlan {
  /**
   * The plan phase — shown to the user before generation starts so they can
   * review and approve it.
   */
  plan: {
    lectureTitle: string;
    topics: {
      title: string;
      questionTypes: { type: string; count: number }[];
      totalQuestions: number;
    }[];
    totalQuestions: number;
    /** e.g. "~12 minutes" */
    estimatedDuration: string;
  }[];
  planGeneratedAt: Date;
  /** true once the user has confirmed the plan before generation begins */
  approvedByUser: boolean;
  approvedAt?: Date;

  /** Per-task execution status — visible to the user as generation runs */
  tasks: {
    taskId: string;
    /** e.g. "Generating Sorting — MCQ (3 questions)" */
    label: string;
    lectureTitle: string;
    topicTitle: string;
    questionType: string;
    questionCount: number;
    status: "pending" | "in_progress" | "completed" | "failed";
    startedAt?: Date;
    completedAt?: Date;
    errorMessage?: string;
  }[];

  generationStatus:
    | "planning"
    | "awaiting_approval"
    | "generating"
    | "completed"
    | "failed";
  generationStartedAt?: Date;
  generationCompletedAt?: Date;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
}

// ---------------------------------------------------------------------------
// IQuiz — course-level quiz created by Qz team / admin
//
// Index recommendations:
//   { courseId: 1 }
//   { status: 1, isAvailable: 1 }
// ---------------------------------------------------------------------------

export type QuizStatus = "draft" | "published" | "archived";

export interface IQuizSettings {
  timeLimit?: number;
  shuffleQuestions: boolean;
  showHints: boolean;
  showExplanations: boolean;
}

export interface IQuiz extends Document {
  _id: Types.ObjectId;
  title: string;
  description?: string;

  courseId: Types.ObjectId;
  createdBy?: Types.ObjectId;

  status: QuizStatus;

  isAvailable: boolean;
  availableFrom?: Date;
  availableTo?: Date;
  /** Default 70 (percent) */
  passingScore: number;

  settings: IQuizSettings;
  tags: string[];

  lectures: IQuizLecture[];

  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// IPersonalQuiz — AI-generated, user-owned quiz
//
// Index recommendations:
//   { createdBy: 1, courseId: 1 }
//   { courseId: 1, "aiGenerationPlan.generationStatus": 1 }
// ---------------------------------------------------------------------------

export interface IPersonalQuiz extends Document {
  _id: Types.ObjectId;
  title: string;
  description?: string;

  // Denormalized institution lineage
  materialId?: Types.ObjectId;
  courseId: Types.ObjectId;
  universityId?: Types.ObjectId;

  createdBy: Types.ObjectId;

  /** Same lecture→topic→questionGroup hierarchy as IQuiz */
  lectures: IQuizLecture[];

  settings: {
    timeLimit?: number; // minutes
    shuffleQuestions: boolean;
    showHints: boolean;
    showExplanations: boolean;
    allowRetakes: boolean;
    passingScore: number; // percentage
  };

  stats: {
    totalAttempts: number;
    averageScore: number;
    bestScore: number;
    lastAttempted?: Date;
  };

  /** Live AI generation plan visible throughout the generation lifecycle */
  aiGenerationPlan?: IAIGenerationPlan;

  isPublic: boolean;
  tags: string[];
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Legacy / supplementary types
// ---------------------------------------------------------------------------

export interface FilteredQuestions {
  name: string; // lecture number, IA (Internal Assessment), or Quizzes label
  questions: Types.ObjectId[];
}

export interface IQuizQuestion extends Document {
  _id: Types.ObjectId;
  name: string;
  courseId: Types.ObjectId;
  isApproved: boolean;
  quizQuestions: FilteredQuestions[];
  creditHours: number;
}

/**
 * Lecture-level progress tracking — used inside IProgress.
 * (Distinct from IQuizLecture which describes quiz structure.)
 */
export interface ILectureProgress {
  name: string;
  completed: number;
  total: number;
  date: Date;
}

export interface IProgress extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  lectureProgress: ILectureProgress[];
  courseId: Types.ObjectId;
  quizId: Types.ObjectId;
}

export interface IUserCourseEnrollment extends Document {
  _id: Types.ObjectId;
  userId?: Types.ObjectId;
  contactId?: Types.ObjectId;
  email?: string;
  studentId?: string;
  courseId: Types.ObjectId;
  semester: string;
  academicYear: string;
  status: "active" | "dropped" | "completed";
  enrolledAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Exam Timetable
//
// Index recommendations:
//   { semester: 1, academicYear: 1 }
//   { "entries.courseId": 1 }
//   { "entries.scheduledAt": 1 }
// ---------------------------------------------------------------------------

/** A mapping of a specific venue to a range of student index numbers. */
export interface IVenueMapping {
  venue: string;
  indexStart?: string;
  indexEnd?: string;
}

/** A single exam session (batch) embedded within IExamEntry. */
export interface IExamSession {
  sessionId: string;
  label?: string; // e.g. "Batch 1"
  scheduledAt: Date;
  venues: IVenueMapping[];
  durationMinutes: number;
}

/**
 * A course entry that changed during timetable reconciliation (a new session
 * was added). Consumed by the consolidated change-notification flow so
 * enrolled students learn about new/rescheduled papers.
 */
export interface IChangedTimetableEntry {
  courseId: Types.ObjectId;
  courseCode: string;
  sessions: IExamSession[];
  semester: string;
  academicYear: string;
}

/** A single exam entry embedded within IExamTimetable, now supporting multiple batches. */
export interface IExamEntry {
  courseId: Types.ObjectId;
  courseName: string;
  courseCode: string;

  examType: "midterm" | "final" | "resit" | "supplementary";
  sessions: IExamSession[];
  semester: string;
  academicYear: string;
  invigilators: Types.ObjectId[];
  isPublished: boolean;
  isAutoSynced: boolean;

  // New fields for richer inspection and change detection
  venueStatus?: string;        // e.g. "PENDING", "Pending Schedule"
  scheduleStatus?: string;     // e.g. "Scheduled", "Not Scheduled"
  venueVisible?: boolean;      // e.g. true/false from VENUE_VISIBLE
  examMode?: string;           // e.g. "SIT-IN / PEN-TO-PAPER", "ONLINE OFF-SITE / TAKE HOME"
}

/**
 * One university-wide timetable document.
 * Entries are embedded for atomic publish/unpublish and simple pagination.
 */
export interface IExamTimetable extends Document {
  _id: Types.ObjectId;
  semester: string;
  academicYear: string;
  isPublished: boolean;
  publishedAt?: Date;
  createdBy: Types.ObjectId;
  entries: IExamEntry[];
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Recommendation
//
// Index recommendations:
//   { userId: 1, dismissed: 1, expiresAt: 1 }
//   { userId: 1, contentType: 1, contentId: 1 } unique (prevent duplicates)
//   { universityId: 1, contentType: 1 }
//   { expiresAt: 1 }   ← TTL index candidate for automatic cleanup
// ---------------------------------------------------------------------------

export type RecommendationContentType =
  | "quiz"
  | "material"
  | "course"
  | "flashcard_set"
  | "study_partner"
  | "video"
  | "mind_map"
  | "note";

export type RecommendationReason =
  | "ai_suggested"
  | "trending"
  | "peer_activity"
  | "completion_gap"
  | "exam_prep"
  | "identified_weakness";

/**
 * A single content recommendation surfaced to a user.
 *
 * Recommendations are generated by the AI pipeline or by the analytics
 * engine and delivered via the `notification:recommendation_update` job on
 * the short queue.  They expire automatically (set a TTL index on expiresAt)
 * so stale suggestions never linger.
 */
export interface IRecommendation extends Document {
  _id: Types.ObjectId;

  /** The user this recommendation is for. */
  userId: Types.ObjectId;

  contentType: RecommendationContentType;
  /** The _id of the recommended document (IQuiz, IMaterial, ICourse, etc.). */
  contentId: Types.ObjectId;

  reason: RecommendationReason;

  /**
   * Relevance score in the range [0, 1].
   * Higher = more likely to be relevant for the user.
   * Used to order recommendations in the UI.
   */
  relevanceScore: number;

  /** Short AI-generated rationale shown beneath the recommendation card. */
  rationale?: string;

  /** True once the user taps "Not interested". Hides from the feed. */
  dismissed: boolean;
  dismissedAt?: Date;

  /** True once the user taps/opens the recommendation. */
  clicked: boolean;
  clickedAt?: Date;

  /**
   * Optional hard expiry.  After this date the recommendation is considered
   * stale (e.g. an exam-prep recommendation expires after the exam date).
   * Set a MongoDB TTL index on this field to auto-delete expired documents.
   */
  expiresAt?: Date;

  createdAt: Date;
}

// ---------------------------------------------------------------------------
// LibraryMaterial
// ---------------------------------------------------------------------------

export type LibraryMaterialStatus = "pending_review" | "published" | "rejected";

export interface ILibraryMaterial extends Document {
  _id: Types.ObjectId;
  materialId: Types.ObjectId;
  title: string;
  description?: string;
  universityId?: Types.ObjectId;
  courseId?: Types.ObjectId;
  subject?: string;
  year?: number;
  tags: string[];
  submittedBy: Types.ObjectId;
  status: LibraryMaterialStatus;
  reviewedBy?: Types.ObjectId;
  publishedAt?: Date;
  rejectionReason?: string;
  useCount: number;
  quizGenerated?: boolean;
  quizGeneratedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// QuizAttempt
// ---------------------------------------------------------------------------

export interface IQuizAttemptEntry {
  quizId: Types.ObjectId;
  status: "pending" | "confirmed";
  attemptedAt: Date;
}

/** One document per user. Tracks rolling 12-hour quiz attempt usage. */
export interface IQuizAttempt extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  attempts: IQuizAttemptEntry[];
}

// ---------------------------------------------------------------------------
// Course
// ---------------------------------------------------------------------------

export interface ICourse extends Document {
  _id: Types.ObjectId;
  code: string;
  title: string;
  about: string;
  isCustom: boolean;
  sources: Types.ObjectId[];
  numberOfLectures?: number;
  approvedQuestionsCount: number;
  semester?: number;
  creditHours?: number;
  year: number;
  isDeleted: boolean;
  createdBy: Types.ObjectId;
  isShared: boolean;
  sharedAcrossSchools?: boolean;
  tags?: string[];
  programIds: Types.ObjectId[];
  credits?: number;
  courseCode?: string;
  prerequisites: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Guest Timetable Reminders
// ---------------------------------------------------------------------------

export interface IGuestExamPaper {
  courseCode: string;
  courseName: string;
  scheduledAt: string | Date;
  venue?: string;
  assignedVenue?: string;
  semester?: string;
  academicYear?: string;
}

export interface ICreateGuestExamReminderInput {
  email: string;
  name?: string;
  studentId?: string;
  courseCodes?: string[];
  papers?: IGuestExamPaper[];
}

