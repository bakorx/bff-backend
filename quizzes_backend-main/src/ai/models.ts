import crypto from "crypto";
import { Schema, model, Model } from "mongoose";
import { IAIResponse, IAIUsageTransaction, IChatbotPersona, IStudyPartnerSession } from "./interfaces";

const AiResponseSchema = new Schema<IAIResponse>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "User",
    },
    questionId: {
      type: Schema.Types.ObjectId,
      ref: "Question",
    },
    query: {
      type: String,
      required: true,
    },
    responses: [{
      modelName: {
        type: String,
        required: true,
      },
      response: {
        type: String,
        required: true,
      }, 
      probabilityScore: {
        type: Number,
        min: 0,
        max: 100,
        required: true,
      },
      responseTimeMs: {
        type: Number,
      },
      tokensUsed: {
        type: Number,
      },
      evaluationMetrics: {
        accuracy: {
          type: Number,
          min: 0,
          max: 100,
        },
        relevance: {
          type: Number,
          min: 0,
          max: 100,
        },
        clarity: {
          type: Number,
          min: 0,
          max: 100,
        }, 
        confidence: {
          type: Number,
          min: 0,
          max: 100,
        },
      }
    }],
    selectedResponse: {
      type: String,
    },
    selectedModelName: {
      type: String,
      required: false, // Migration Notes
    }, 
    creditsCharged: {
      type: Number,
      required: true,
    },
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: "StudyPartnerSession",
    },
    queryType: {
      type: String,
      enum: ["explanation", "answer", "hint", "discussion", "other" ],
      required: true,
    },
    personaId: {
      type: Schema.Types.ObjectId,
      ref: "ChatbotPersona",
      required: false, // Migration Notes
    }
  },
  {
    timestamps: true
  }
);

AiResponseSchema.index({userId: 1, createdAt: -1});
AiResponseSchema.index({sessionId: 1, createdAt: -1});

export const AiResponse: Model<IAIResponse> = model<IAIResponse>("AiResponse", AiResponseSchema);

const AIUsageTransactionSchema = new Schema<IAIUsageTransaction>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "User",
    },
    transactionType: {
      type: String,
      enum: ["debit", "credit", "refund"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    balanceAfter: {
      type: Number,
      required: true,
    },
    balanceBefore: {
      type: Number,
      required: true,
    },
    reason: {
      type: String,
      required: true,
    },
    aiResponse: {
      type: Schema.Types.ObjectId,
      ref: "AIResponse",
    },
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: "StudyPartnerSession",
    },
    paymentId: {
      type: Schema.Types.ObjectId,
      ref: "Payment",
    },
    metadata: {
      modelUsage: {
        type: String,
      },
      tokensConsumed: {
        type: Number,
      },
      responseTime: {
        type: Number,
      }
    }
  },
  {
    timestamps: true,
  }
);

AIUsageTransactionSchema.index({userId: 1, createdAt: -1});

export const AiUsageTransaction: Model<IAIUsageTransaction> = model<IAIUsageTransaction>("AiUsageTransaction", AIUsageTransactionSchema);

const ChatbotPersonaSchema = new Schema<IChatbotPersona>(
  {
    name: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    personalityTraits: {
      type: [String],
      required: true,
    },
    responseStyle: {
      type: String,
      enum: ["friendly", "professional", "encouraging", "concise", "detailed"],
      required: true,
    },
    systemPrompt: {
      type: String,
      required: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
      // The uniqueness will require a custom logic
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    usageCount: {
      type: Number,
      default: 0,
    },
    averageRating: {
      type: Number,
      default: 0,
    }, 
    schoolId: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: false, //Migration Notes
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    }
  },
  {
    timestamps: true
  },
);

ChatbotPersonaSchema.index({isDefault: 1, isActive: 1});
ChatbotPersonaSchema.index({schoolId: 1, isActive: 1 });

export const ChatbotPersona: Model<IChatbotPersona> = model<IChatbotPersona>("ChatbotPersona", ChatbotPersonaSchema);

const SessionTaskSchema = new Schema(
  {
    taskId: {
      type: String,
      default: () => crypto.randomUUID(),
    },
    type: {
      type: String,
      enum: [
        "explain",
        "demonstrate",
        "discuss",
        "challenge",
        "ask_questions",
        "generate_quiz",
        "recap",
        "review",
        "summarise",
      ],
      required: true,
    },
    label: {
      type: String,
      required: true,
    },
    questionCount: {
      type: Number,
    },
    status: {
      type: String,
      enum: ["pending", "active", "completed", "skipped"],
      default: "pending",
    },
    startedAt: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
    directiveFired: {
      type: String,
      enum: [
        "SHOW_PLAN",
        "SHOW_QUIZ",
        "ASK_QUESTION",
        "ASK_QUESTIONS",
        "SHOW_RESULT",
        "SHOW_PROGRESS",
        "SHOW_SUGGESTION",
        "SHOW_SUMMARY",
        "UNLOCK_TOPIC",
        "SHOW_EXPLANATION",
        "SHOW_DEMONSTRATION",
      ],
    },
    result: {
      score: { type: Number },
      passed: { type: Boolean },
      questionsAsked: { type: Number },
      questionsCorrect: { type: Number },
      mode: {
        type: String,
        enum: [
          "explain",
          "demonstrate",
          "discuss",
          "clarify",
          "challenge",
          "test",
          "recap",
          "idle",
        ],
      },
    },
  },
  { _id: false }
);

const AgentTopicSchema = new Schema(
  {
    topicTitle: {
      type: String,
      required: true,
    },
    tasks: {
      type: [SessionTaskSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ["locked", "active", "completed"],
      default: "locked",
    },
    unlockedAt: {
      type: Date,
    },
  },
  { _id: false }
);

const AgentLectureSchema = new Schema(
  {
    materialId: {
      type: Schema.Types.ObjectId,
      ref: "Material",
    },
    lectureTitle: {
      type: String,
      required: true,
    },
    lectureNumber: {
      type: String,
    },
    topics: {
      type: [AgentTopicSchema],
      default: [],
    },
  },
  { _id: false }
);

const AgentPlanSchema = new Schema(
  {
    goal: {
      type: String,
      required: true,
    },
    plan: {
      type: [AgentLectureSchema],
      default: [],
    },
    totalTasks: {
      type: Number,
      required: true,
    },
    completedTasks: {
      type: Number,
      default: 0,
    },
    estimatedMinutes: {
      type: Number,
      required: true,
    },
    currentTaskId: {
      type: String,
    },
    planApprovedByUser: {
      type: Boolean,
      default: false,
    },
    planApprovedAt: {
      type: Date,
    },
    generatedAt: {
      type: Date,
      required: true,
    },
  },
  { _id: false }
);

const ZSessionMessageSchema = new Schema(
  {
    messageId: {
      type: String,
      default: () => crypto.randomUUID(),
    },
    role: {
      type: String,
      enum: ["user", "z", "peer", "system"],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ["text", "directive", "thinking", "tool_call", "tool_result"],
      required: true,
    },
    directive: {
      type: Schema.Types.Mixed,
    },
    thinking: {
      type: String,
    },
    toolCall: {
      type: Schema.Types.Mixed,
    },
    toolResult: {
      type: Schema.Types.Mixed,
    },
    mode: {
      type: String,
      enum: [
        "explain",
        "demonstrate",
        "discuss",
        "clarify",
        "challenge",
        "test",
        "recap",
        "idle",
      ],
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    isStreaming: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const SummarySchema = new Schema(
  {
    topicsCovered: {
      type: [String],
      default: [],
    },
    overallScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    strongAreas: {
      type: [String],
      default: [],
    },
    weakAreas: {
      type: [String],
      default: [],
    },
    recommendation: {
      type: String,
      required: true,
    },
    nextSessionFocus: {
      type: String,
      required: true,
    },
    encouragement: {
      type: String,
      required: true,
    },
    generatedAt: {
      type: Date,
      required: true,
    },
  },
  { _id: false }
);

export const StudyPartnerSessionSchema = new Schema<IStudyPartnerSession>(
  {
    sessionId: {
      type: String,
      unique: true,
      required: true,
    },
    participants: {
      type: [Schema.Types.ObjectId],
      required: true,
      ref: "User",
    },
    courseId: {
      type: Schema.Types.ObjectId,
      required: false,
      ref: "Course",
    },
    materialId: {
      type: Schema.Types.ObjectId,
      ref: "Material",
    },
    materials: [
      {
        type: Schema.Types.ObjectId,
        ref: "Material",
      },
    ],
    title: {
      type: String,
    },
    sessionType: {
      type: String,
      enum: ["discussion", "quiz-solving", "material-review"],
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    messages: [{
      senderId: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: "User",
      },
      content: {
        type: String,
        required: true,
      },
      timestamp: {
        type: Date,
      },
      isAI: {
        type: Boolean,
        default: false,
      },
      creditsUsed: {
        type: Number,
        default: 0,
      },
      personaUsed: {
        type: Schema.Types.ObjectId,
        ref: "ChatbotPersona",
      },
    }],
    quizAttempts: {
      type: [Schema.Types.ObjectId],
      ref: "Quizzes",
    },
    aiAssistanceEnabled: {
      type: Boolean,
      default: true,
    },
    activePersonaId: {
      type: Schema.Types.ObjectId,
      default: null,
      required: false, //Migration Notes
      ref: "ChatbotPersona",
    },
    totalCreditsUsed: {
      type: Number,
      default: 0,
    },
    currentLectureIndex: {
      type: Number,
      default: 0,
    },
    currentTopicIndex: {
      type: Number,
      default: 0,
    },
    agentPlan: {
      type: AgentPlanSchema,
    },
    currentMode: {
      type: String,
    },
    zMessages: {
      type: [ZSessionMessageSchema] as any,
      default: [],
    },
    summary: {
      type: SummarySchema,
    },
    status: {
      type: String,
      enum: ["pending", "active", "paused", "completed", "abandoned"],
      default: "pending",
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    endedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

StudyPartnerSessionSchema.index({ participants: 1, status: 1 });
StudyPartnerSessionSchema.index({ courseId: 1, userId: 1 });
StudyPartnerSessionSchema.index({ "agentPlan.currentTaskId": 1 });

export const StudyPartnerSession: Model<IStudyPartnerSession> = model<IStudyPartnerSession>("StudyPartnerSession", StudyPartnerSessionSchema);

