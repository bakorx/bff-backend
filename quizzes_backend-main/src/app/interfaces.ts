import { Document, Types } from "mongoose";
export * from "./skills/interfaces";

export type SessionMode = "free" | "structured";

export type PlanningMode = "planning" | "fast";

export type AgentPhase =
  | "idle"
  | "analysis"
  | "planning"
  | "awaiting_approval"
  | "implementation"
  | "verification"
  | "signoff"
  | "complete"
  | "interrupted";

export type SessionStatus = "active" | "paused" | "completed" | "abandoned";

export type ArtifactType =
  | "study_plan"
  | "directive"
  | "lesson"
  | "flashcard_set"
  | "quiz"
  | "mindmap"
  | "notes"
  | "verification"
  | "walkthrough"
  | "mini_walkthrough"
  | "recap"
  | "exposition"
  | "question"
  | "summary";

// ─── Artifact content types ───────────────────────────────────────────────────

export interface IKnowledgeBlock {
  blockId: string;
  title: string;
  summary?: string;
  materialId?: string;
  sourceChunkIds?: string[];
  completed: boolean;
  completedAt?: Date;
  order: number;
}

export interface IChapterGoal {
  goalId: string;
  title: string;
  description?: string;
  status: "pending" | "active" | "completed" | "skipped";
  targetBlockIds?: string[];
  completedAt?: Date;
}

export interface IStudyStep {
  stepId: string;
  topicId?: string;
  label?: string;
  order: number;
  title: string;
  description?: string;
  coreIdea?: string;
  whyItMatters?: string;
  prerequisites: IKnowledgeBlock[];
  goals?: IChapterGoal[];
  completedBlocks: number;
  totalBlocks: number;
  isCompleted?: boolean;
}

export interface IStudyChapter {
  chapterId: string;
  number: number;
  chapterNumber?: number;
  title: string;
  description: string;
  isRecommended?: boolean;
  goals: IChapterGoal[];
  steps: IStudyStep[];
  completedBlocks: number;
  totalBlocks: number;
}

export interface IStudyPlan extends Document {
  sessionId: Types.ObjectId;
  userId: Types.ObjectId;
  courseId?: Types.ObjectId;
  goal: string;
  chapters: IStudyChapter[];
  totalChapters: number;
  totalBlocks: number;
  completedBlocks: number;
  estimatedMinutes: number;
  approvedAt?: Date;
  editedByUser: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface StudyPlan {
  _id?: Types.ObjectId | string;
  sessionId?: string | Types.ObjectId;
  userId?: string | Types.ObjectId;
  courseId?: string | Types.ObjectId;
  goal: string;
  chapters: IStudyChapter[];
  totalChapters: number;
  totalBlocks: number;
  completedBlocks: number;
  estimatedMinutes: number;
  approvedAt?: Date;
  editedByUser: boolean;
}

export interface IDirectiveArtifact {
  directiveType:
    | "ask_question"
    | "ask_questions"
    | "show_quiz"
    | "show_result"
    | "show_suggestion"
    | "show_summary"
    | "pomodoro"
    | "unlock_topic"
    | "chapter_milestone";
  payload: Record<string, unknown>;
  response?: Record<string, unknown>;
  respondedAt?: Date;
  status: "pending" | "answered" | "dismissed";
}

export interface LessonContent {
  topicTitle: string;
  body: string; // markdown
  keyPoints: string[];
  examples: { label: string; content: string }[];
  analogy?: string;
}

export interface FlashcardSetContent {
  cards: {
    cardId: string;
    front: string;
    back: string;
    tags: string[];
  }[];
  savedToLibrarySetId?: string;
}

export interface QuizQuestion {
  questionId: string;
  type: "mcq" | "true_false" | "short_answer" | "fill_in_blank" | "essay";
  text: string;
  options?: string[];
  correctAnswer?: string;
  hint?: string;
  explanation: string;
}

export interface QuizContent {
  questions: QuizQuestion[];
  lectures?: {
    title: string;
    topics: {
      title: string;
      questions: QuizQuestion[];
    }[];
  }[];
  savedToPersonalQuizId?: string;
}

export interface MindMapContent {
  nodes: {
    id: string;
    label: string;
    type: "concept" | "topic" | "detail" | "question";
    parentId?: string;
    position: { x: number; y: number };
  }[];
  edges: {
    id: string;
    source: string;
    target: string;
    label?: string;
  }[];
}

export interface NotesContent {
  sections: {
    title: string;
    body: string;
  }[];
}

export interface VerificationContent {
  method: "quiz" | "teachback" | "both";
  quiz?: QuizContent;
  teachbackPrompt?: string;
  studentResponse?: string;
  passed: boolean;
  score?: number;
  feedback: string;
  verifiedAt?: Date;
}

export interface WalkthroughContent {
  type: "full" | "mini";
  goalId?: string;
  goalTitle?: string;
  mastered: string[];
  gaps: string[];
  recommendations: string[];
  nextSteps: string[];
  sessionSummary?: string;
}

// ─── Artifact ─────────────────────────────────────────────────────────────────

export interface IArtifact {
  artifactId: string;
  type: ArtifactType;
  title: string;
  content:
    | StudyPlan
    | IDirectiveArtifact
    | LessonContent
    | FlashcardSetContent
    | QuizContent
    | MindMapContent
    | NotesContent
    | VerificationContent
    | WalkthroughContent;
  phase: AgentPhase;
  goalId?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Course Summary (Domain Model) ──────────────────────────────────────────

export interface ICourseSummaryLogicalPillar {
  pillarNumber?: number;
  title: string;
  description?: string;
  topics?: string[];
}

export interface ICourseSummaryTopicDeepDive {
  title: string;
  topic?: string;
  description?: string;
  content?: string;
}

export interface ICourseSummarySection {
  title: string;
  body: string;
}

export interface ICourseSummaryDoc {
  sessionId: string;
  userId: string;
  courseId?: string;
  title: string;
  overview: string;
  logicalPillars: ICourseSummaryLogicalPillar[];
  topicDeepDives: ICourseSummaryTopicDeepDive[];
  keyTakeaways: string[];
  sections: ICourseSummarySection[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ICourseSummary extends Document {
  sessionId: Types.ObjectId;
  userId: Types.ObjectId;
  courseId?: Types.ObjectId;
  title: string;
  overview: string;
  logicalPillars: ICourseSummaryLogicalPillar[];
  topicDeepDives: ICourseSummaryTopicDeepDive[];
  keyTakeaways: string[];
  sections: ICourseSummarySection[];
  createdAt: Date;
  updatedAt: Date;
}

// ─── Goal ─────────────────────────────────────────────────────────────────────

export interface IGoal {
  goalId: string;
  title: string;
  description?: string;
  status: "pending" | "active" | "completed" | "skipped";
  artifactIds: string[];
  startedAt?: Date;
  completedAt?: Date;
  miniWalkthroughId?: string;
}

// ─── Session message ──────────────────────────────────────────────────────────

export interface SessionHighlight {
  id: string;
  materialId: string;
  pageNumber: number;
  text: string;
  note?: string;
  color?: string;
  bounds: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
  createdAt: Date;
}

export interface SessionCitation {
  citationId: string;
  marker: string;
  materialId: string;
  filename: string;
  excerpt: string;
  pageNumber?: number;
  messageId: string;
}

export interface ISessionMessage {
  messageId: string;
  role: "user" | "z" | "system" | "peer";
  authorId?: string;
  authorName?: string;
  content: string;
  replyToMessageId?: string;
  type:
    | "text"
    | "artifact"
    | "tool_call"
    | "tool_result"
    | "steering"
    | "directive"
    | "system_action";
  artifactId?: string;
  artifact?: IArtifact | Record<string, unknown>;
  toolCall?: { name: string; input: Record<string, unknown> };
  toolResult?: { name: string; output: unknown };
  directive?: Record<string, unknown>;
  citations?: SessionCitation[];
  phase: AgentPhase;
  timestamp: Date;
  isStreaming?: boolean;
  rating?: 1 | -1;
}

// ─── Memory ───────────────────────────────────────────────────────────────────

export interface ISessionMemory {
  userId: string;
  courseId?: string;
  knownConcepts: string[];
  gaps: string[];
  masteredGoals: string[];
  studyPatterns: {
    preferredMode: PlanningMode;
    averageSessionMins: number;
    strongTopics: string[];
    weakTopics: string[];
  };
  lastUpdatedAt: Date;
  lastSessionId?: string;
}

// ─── Study session ────────────────────────────────────────────────────────────

export interface IStudySession extends Document {
  name: string;
  userId: Types.ObjectId;
  courseId?: Types.ObjectId;
  mode: SessionMode;
  planningMode: PlanningMode;
  status: SessionStatus;
  currentPhase: AgentPhase;
  previousPhase?: AgentPhase;

  // Active navigation pointer
  activeChapterId?: string;
  activeStepId?: string;
  activeBlockId?: string;
  activeChapterGoalId?: string;

  // Quick-access mastery tracking
  completedBlockIds: string[];
  totalBlocks: number;
  completedBlocks: number;

  // Linked StudyPlan Model reference & population
  studyPlan?: Types.ObjectId | IStudyPlan;

  // Linked CourseSummary Model reference & population
  courseSummary?: Types.ObjectId | ICourseSummary;

  goals: IGoal[];
  currentGoalId?: string;
  materialIds: Types.ObjectId[];
  isTransient?: boolean;
  artifacts: IArtifact[];
  messages: ISessionMessage[];
  citations: SessionCitation[];
  highlights: SessionHighlight[];
  equippedSkills: string[];
  memorySnapshot?: ISessionMemory;
  studio: {
    savedFlashcardSetIds: string[];
    savedQuizIds: string[];
    savedFlashcardArtifactIds: string[];
    savedQuizArtifactIds: string[];
    sharedNotes: {
      id: string;
      content: string;
      authorId: string;
      authorName: string;
      createdAt: Date;
    }[];
    exportedFiles: {
      exportId: string;
      type: "pdf" | "markdown";
      url: string;
      generatedAt: Date;
    }[];
    mindMap?: MindMapContent;
  };
  startedAt?: Date;
  completedAt?: Date;
  durationMinutes?: number;
  interruptState?: {
    interruptedAt: Date;
    interruptReason: string;
    resumeFrom: AgentPhase;
    pendingInstruction: string;
  };
  peers: {
    id: Types.ObjectId;
    joinedAt?: Date;
  }[];
}

// ─── Study task ───────────────────────────────────────────────────────────────

export type TaskStatus = "active" | "completed";

export interface ITask extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  title: string;
  subject?: string;
  status: TaskStatus;
  completedAt?: Date;
  isDeleted?: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITasksMetadata {
  completed: number;
  total: number;
  progress: number;
}

