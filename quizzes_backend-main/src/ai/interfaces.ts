import { Document, Types } from "mongoose";
import { IAIGenerationPlan } from "@/learning";

export type OpenRouterFreeModel =
  | "openai/openrouter/free"
  | "openai/openrouter/auto"
  | "openai/cohere/north-mini-code:free"
  | "openai/nvidia/nemotron-3-super-120b-a12b:free"
  | "openai/minimax/minimax-m3:free";

export type OpenRouterPaidModel =
  | "openai/gpt-4o-mini"
  | "openai/gpt-4o"
  | "openai/openai/gpt-4o-mini"
  | "openai/openai/gpt-4o";

export type GoogleFreeModel =
  | "googleai/gemini-3.5-flash-lite"
  | "googleai/gemini-3-flash-preview"
  | "googleai/gemini-3.1-flash-lite";

export type GooglePaidModel =
  | "googleai/gemini-3.6-flash";

export type GroqFreeModel =
  | "groq/openai/gpt-oss-20b"
  | "groq/qwen/qwen3.8-27b";

export type GroqPaidModel =
  | "groq/openai/gpt-oss-120b";

export type AIModel =
  | OpenRouterFreeModel
  | OpenRouterPaidModel
  | GoogleFreeModel
  | GooglePaidModel
  | GroqFreeModel
  | GroqPaidModel
  | (string & {});

export interface SystemPromptOptions {
  personaPrompt?: string;
  context?: string;
  instructions?: string;
  mode?: string;
  topic?: string;
  difficulty?: string;
}

export interface IAIResponse extends Document {
  userId: Types.ObjectId;
  questionId?: Types.ObjectId;
  query: string;
  responses: {
    modelName: string;
    response: string;
    probabilityScore?: number;
    responseTimeMs?: number;
    tokensUsed?: number;
    evaluationMetrics?: {
      accuracy?: number;
      relevance?: number;
      clarity?: number;
      confidence?: number;
    };
  }[];
  selectedResponse?: string;
  selectedModelName?: string;
  creditsCharged: number;
  sessionId?: Types.ObjectId;
  queryType: "explanation" | "answer" | "hint" | "discussion" | "other";
  personaId?: Types.ObjectId;
}

export interface IAIUsageTransaction extends Document {
  userId: Types.ObjectId;
  transactionType: "debit"| "credit" | "refund";
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  reason: string;
  aiResponse: Types.ObjectId;
  sessionId: Types.ObjectId;
  paymentId: Types.ObjectId;
  metadata: {
    modelUsage?: string;
    tokensConsumed?: number;
    responseTime?: number;
  };
}

// ---------------------------------------------------------------------------
// Study Partner Session
//
// Index recommendations:
//   { sessionId: 1 } unique
//   { "participants": 1, courseId: 1 }
//   { courseId: 1, isActive: 1 }
// ---------------------------------------------------------------------------

export interface IStudyPartnerSession extends Document {
  sessionId: string;
  participants: Types.ObjectId[];
  courseId?: Types.ObjectId;
  materialId?: Types.ObjectId;
  materials: Types.ObjectId[];
  title?: string;
  sessionType: "discussion" | "quiz-solving" | "material-review";
  isActive?: boolean;

  /** "ai" = user + AI tutor; "peer" = user + another user */
  mode: "ai" | "peer";

  messages: {
    senderId: Types.ObjectId;
    content: string;
    timestamp: Date;
    isAI?: boolean;
    creditsUsed?: number;
    personaUsed?: Types.ObjectId;
  }[];

  quizAttempts?: Types.ObjectId[];
  aiAssistanceEnabled?: boolean;
  activePersonaId?: Types.ObjectId;
  totalCreditsUsed?: number;

  /** Index of the lecture the session is currently working through */
  currentLectureIndex: number;
  /** Index of the topic within the current lecture */
  currentTopicIndex: number;

  /**
   * Per-lecture, per-topic progress tracking.
   * Mirrors the quiz lecture/topic hierarchy so the session can gate advancement.
   */
  progress: {
    lectureTitle: string;
    topics: {
      title: string;
      attempted: boolean;
      passed: boolean;
      /** 0–100 */
      score: number;
      attempts: number;
      unlockedNextTopic: boolean;
    }[];
    lectureCompleted: boolean;
  }[];

  /**
   * Gating controls — set by the user, not the admin.
   * If enabled = false, the user can navigate freely without passing quizzes.
   */
  gatingSettings: {
    enabled: boolean;
    /** Minimum score to advance to the next topic. Default 70. */
    passingScore: number;
    /** If true, the session auto-advances to the next topic on pass. */
    advanceOnPass: boolean;
  };

  agentPlan?: any;
  currentMode?: string;
  zMessages: any[];
  summary?: any;
  status: "pending" | "active" | "paused" | "completed" | "abandoned";

  /** The currently running AI-generated quiz for this session, if any. */
  activeQuizId?: Types.ObjectId;

  /** Live AI generation plan displayed to the user while a quiz is being generated. */
  aiGenerationPlan?: IAIGenerationPlan;

  startedAt: Date;
  endedAt?: Date;
}

export interface IChatbotPersona extends Document {
  name: string;
  description: string;
  personalityTraits: string[];
  responseStyle:
    | "friendly"
    | "professional"
    | "encouraging"
    | "concise"
    | "detailed";
  systemPrompt: string;
  isDefault?: boolean;
  isActive?: boolean;
  usageCount?: number;
  averageRating?: number;
  schoolId?: Types.ObjectId;
  createdBy?: Types.ObjectId;
}

