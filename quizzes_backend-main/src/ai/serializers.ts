import { z } from "zod";

export const AiResponseSerializer = z.object({
  userId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid user ID").describe("The user making the query"),
  questionId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional().describe("Contextual question this references"),
  query: z.string().min(1, "Query is required").describe("The prompt sent to the AI"),
  responses: z.array(z.object({
    modelName: z.string().min(1).describe("Which AI model generated this (e.g. gpt-4)"),
    response: z.string().min(1).describe("The generated text"),
    probabilityScore: z.number().min(0).max(100).describe("Confidence score of generation"),
    responseTime: z.number().optional().describe("Time taken in ms"),
    tokensUsed: z.number().optional().describe("Token computation cost"),
    evaluationMetrics: z.object({
      accuracy: z.number().min(0).max(100).optional(),
      relevance: z.number().min(0).max(100).optional(),
      clarity: z.number().min(0).max(100).optional(),
      confidence: z.number().min(0).max(100).optional(),
    }).optional().describe("Automatic evaluation metrics"),
  })).describe("The generated potential answers"),
  selectedResponse: z.string().optional().describe("Which response the user or system actually picked"),
  selectedModelName: z.string().optional().describe("The model that generated the selected response"),
  creditsCharged: z.number().min(0).describe("The final cost deducted from user balance"),
  sessionId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional().describe("Part of a study partner session"),
  queryType: z.enum(["explanation", "answer", "hint", "discussion", "other"]).describe("Categorization of the query intent"),
  personaId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional().describe("Custom persona framing used"),
}).describe("Serializer for AI Response logs");

export const AiUsageTransactionSerializer = z.object({
  userId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid user ID").describe("User whose balance is affected"),
  transactionType: z.enum(["debit", "credit", "refund"]).describe("Direction of the balance change"),
  amount: z.number().min(0).describe("Absolute amount of credits"),
  balanceBefore: z.number().describe("Snapshot credits before transaction"),
  balanceAfter: z.number().describe("Snapshot credits after transaction"),
  reason: z.string().min(1).describe("Human readable justification"),
  aiResponse: z.string().regex(/^[0-9a-fA-F]{24}$/).optional().describe("Related AI query"),
  sessionId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional().describe("Related study session"),
  paymentId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional().describe("Related monetary payment (for topups)"),
  metadata: z.object({
    modelUsage: z.string().optional(),
    tokensConsumed: z.number().optional(),
    responseTime: z.number().optional(),
  }).optional().describe("Additional technical metrics"),
}).describe("Serializer for AI credit ledger entries");

export const ChatbotPersonaSerializer = z.object({
  name: z.string().min(1).describe("Display name of the persona"),
  description: z.string().min(1).describe("Summary of its intent"),
  personalityTraits: z.array(z.string()).min(1).describe("Keywords framing behavior"),
  responseStyle: z.enum(["friendly", "professional", "encouraging", "concise", "detailed"]).describe("Tone of output"),
  systemPrompt: z.string().min(1).describe("The hidden system prompt injected"),
  isDefault: z.boolean().default(false).describe("Whether it's available unconditionally"),
  isActive: z.boolean().default(true).describe("Whether it can be used presently"),
  usageCount: z.number().int().default(0).describe("Analytics track of uses"),
  averageRating: z.number().default(0).describe("User satisfaction score"),
  schoolId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional().describe("Restricted to a specific institution"),
  createdBy: z.string().regex(/^[0-9a-fA-F]{24}$/).optional().describe("User or Admin who created it"),
}).describe("Serializer for Custom AI configurations");

export const StudyPartnerSessionSerializer = z.object({
  sessionId: z.string().min(1).describe("External canonical session ID"),
  participants: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/)).min(1).describe("Users active in the chat"),
  courseId: z.string().regex(/^[0-9a-fA-F]{24}$/).describe("Course context for the chat"),
  materialId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional().describe("Constrained to specific notes"),
  sessionType: z.enum(["discussion", "quiz-solving", "material-review"]).describe("Mode of operation"),
  mode: z.enum(["ai", "peer"]).describe("Session mode — AI-assisted tutor or peer-to-peer study"),
  isActive: z.boolean().default(true).describe("Whether the connection is currently alive"),
  messages: z.array(z.object({
    senderId: z.string().regex(/^[0-9a-fA-F]{24}$/).describe("The user or AI that sent the message"),
    content: z.string().describe("The text content of the message"),
    timestamp: z.date().optional().describe("When the message was sent"),
    isAI: z.boolean().default(false).describe("Whether the message was generated by the AI"),
    creditsUsed: z.number().default(0).describe("Credits deducted for this message if AI-generated"),
    personaUsed: z.string().regex(/^[0-9a-fA-F]{24}$/).optional().describe("The AI persona that generated this message"),
  })).describe("Transient conversation log (may move off Mongo later)"),
  quizAttempts: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/)).optional().describe("Associated test scores"),
  aiAssistanceEnabled: z.boolean().default(true).describe("Whether AI bot can intervene"),
  activePersonaId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional().describe("Which bot is listening"),
  totalCreditsUsed: z.number().default(0).describe("Cumulative cost of this room"),
  startedAt: z.date().default(new Date()).describe("Room open time"),
  endedAt: z.date().nullable().optional().describe("Room close time"),
}).describe("Serializer for synchronized tutor/student or AI chat rooms");