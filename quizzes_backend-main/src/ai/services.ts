import { Types } from "mongoose";
import { ai, Z_MODEL} from "./config";
import { AiResponse, AiUsageTransaction, ChatbotPersona, StudyPartnerSession } from "./models";
import { IAIResponse, IAIUsageTransaction, IChatbotPersona, IStudyPartnerSession, SystemPromptOptions } from "./interfaces";
import { runInTransaction } from "@/utils";
import { User } from "@/users";
import { buildSystemPrompt } from "./config";
import { AI_CONFIG } from "./config";

// --- AI RESPONSE SERVICES ---
export const createAiResponse = async (data: Partial<IAIResponse>) => {
  return await runInTransaction(async (session) => {
    const aiResponse = new AiResponse(data);
    return await aiResponse.save({ session });
  });
};

export const updateAiResponse = async (id: string | Types.ObjectId, data: Partial<IAIResponse>) => {
  return await runInTransaction(async (session) => {
    return await AiResponse.findByIdAndUpdate(id, data, { returnDocument: 'after', session });
  });
};

export const deleteAiResponse = async (id: string | Types.ObjectId) => {
  return await runInTransaction(async (session) => {
    return await AiResponse.findByIdAndDelete(id, { session });
  });
};

// --- AI USAGE TRANSACTION SERVICES ---
export const createAiUsageTransaction = async (data: Partial<IAIUsageTransaction>) => {
  return await runInTransaction(async (session) => {
    const transaction = new AiUsageTransaction(data);
    return await transaction.save({ session });
  });
};

export const updateAiUsageTransaction = async (id: string | Types.ObjectId, data: Partial<IAIUsageTransaction>) => {
  return await runInTransaction(async (session) => {
    return await AiUsageTransaction.findByIdAndUpdate(id, data, { returnDocument: 'after', session });
  });
};

export const deleteAiUsageTransaction = async (id: string | Types.ObjectId) => {
  return await runInTransaction(async (session) => {
    return await AiUsageTransaction.findByIdAndDelete(id, { session });
  });
};

// --- CHATBOT PERSONA SERVICES ---
export const createChatbotPersona = async (data: Partial<IChatbotPersona>) => {
  return await runInTransaction(async (session) => {
    const persona = new ChatbotPersona(data);
    return await persona.save({ session });
  });
};

export const updateChatbotPersona = async (id: string | Types.ObjectId, data: Partial<IChatbotPersona>) => {
  return await runInTransaction(async (session) => {
    return await ChatbotPersona.findByIdAndUpdate(id, data, { returnDocument: 'after', session });
  });
};

export const deleteChatbotPersona = async (id: string | Types.ObjectId) => {
  return await runInTransaction(async (session) => {
    return await ChatbotPersona.findByIdAndUpdate(id, { isActive: false }, { returnDocument: 'after', session });
  });
};

export const incrementPersonaUsageCount = async (id: string | Types.ObjectId) => {
  return await runInTransaction(async (session) => {
    return await ChatbotPersona.findByIdAndUpdate(id, { $inc: { usageCount: 1 } }, { returnDocument: 'after', session });
  });
};

// --- STUDY PARTNER SESSION SERVICES ---
export const createStudyPartnerSession = async (data: Partial<IStudyPartnerSession>) => {
  return await runInTransaction(async (session) => {
    const sess = new StudyPartnerSession(data);
    return await sess.save({ session });
  });
};

export const updateStudyPartnerSession = async (id: string | Types.ObjectId, data: Partial<IStudyPartnerSession>) => {
  return await runInTransaction(async (session) => {
    return await StudyPartnerSession.findByIdAndUpdate(id, data, { returnDocument: 'after', session });
  });
};

export const deleteStudyPartnerSession = async (id: string | Types.ObjectId) => {
  return await runInTransaction(async (session) => {
    return await StudyPartnerSession.findByIdAndUpdate(id, { isActive: false, endedAt: new Date() }, { returnDocument: 'after', session });
  });
};

export const addMessageToSession = async (id: string | Types.ObjectId, message: any) => {
  return await runInTransaction(async (session) => {
    return await StudyPartnerSession.findByIdAndUpdate(id, { $push: { messages: message } }, { returnDocument: 'after', session });
  });
};

// ---------------------------------------------------------------------------
// AI CHAT — Genkit (via OpenRouter)
// ---------------------------------------------------------------------------

/** A single chat history turn. */
export interface ChatTurn {
  role: "user" | "model";
  parts: { text: string }[];
}

/** Result returned by sendChatMessage. */
export interface ChatResult {
  text: string;
  modelName: string;
  tokensUsed?: number;
  responseTimeMs: number;
}

/**
 * Token budget helpers — cost optimisation
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function trimChatHistory(
  history: ChatTurn[],
  maxTokenBudget = 6_000
): ChatTurn[] {
  if (!history.length) return history;
  let tokens = 0;
  const kept: ChatTurn[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    const turnTokens = estimateTokens(turn.parts.map((p) => p.text ?? "").join(" "));
    if (tokens + turnTokens > maxTokenBudget && kept.length > 0) break;
    tokens += turnTokens;
    kept.unshift(turn);
  }
  return kept;
}

export function truncateContext(context: string, maxChars = 4_000): string {
  if (context.length <= maxChars) return context;
  return (
    context.slice(0, maxChars) +
    "\n… [context truncated for cost optimisation]"
  );
}

/**
 * Sends a chat message to the AI via Genkit.
 */
export async function sendChatMessage(
  userMessage: string,
  history: ChatTurn[] = [],
  promptOpts: SystemPromptOptions = {},
  modelOverride?: string,
  historyTokenBudget = 6_000,
  contextMaxChars = 4_000
): Promise<ChatResult> {
  const startTime = Date.now();

  // Apply token-reduction helpers
  const trimmedHistory = trimChatHistory(history, historyTokenBudget);
  const optimisedOpts: SystemPromptOptions = {
    ...promptOpts,
    context: promptOpts.context
      ? truncateContext(promptOpts.context, contextMaxChars)
      : undefined,
  };

  const systemPrompt = buildSystemPrompt(optimisedOpts);

  try {
    const result = await ai.generate({
      system: systemPrompt,
      prompt: userMessage,
      messages: trimmedHistory.map((m: ChatTurn) => ({
        role: m.role as any,
        content: [{ text: m.parts[0].text }]
      })),
    });

    return {
      text: result.text.trim(),
      modelName: Z_MODEL,
      responseTimeMs: Date.now() - startTime,
    };
  } catch (error: any) {
    throw new Error(`AI generation failed: ${error.message}`);
  }
}

/**
 * Builds a ChatTurn history array from a StudyPartnerSession's messages array,
 * limiting to the most recent `maxMessages` messages to keep context window bounded.
 */
export function buildChatHistory(
  messages: IStudyPartnerSession["messages"],
  maxMessages = 40
): ChatTurn[] {
  const recent = messages.slice(-maxMessages);
  return recent.map((m: any) => ({
    role: m.isAI ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

/** A single streaming chunk emitted by zFlow. */
export interface ZFlowChunk {
  reasoning?: string;
  text?: string;
}

/** Genkit Part extended with the reasoning field present on thinking models. */
interface ThinkingPart {
  text?: string;
  reasoning?: string;
}

/**
 * Streaming flow for Z (Claude 3.7 Sonnet with extended thinking).
 *
 * Calls ai.generateStream with Z_MODEL and Z_MODEL_CONFIG.
 * Each chunk is forwarded to the optional onChunk callback:
 *   - part.reasoning  → thinking tokens
 *   - part.text       → text tokens
 *
 * Falls back to Z_FALLBACK_MODEL for a non-streaming response if streaming
 * raises an error.
 */
export async function zFlow(
  prompt: string,
  system?: string,
  onChunk?: (chunk: ZFlowChunk) => void
): Promise<string> {
  try {
    // genkitx-openai model refs are plain strings; cast required by Genkit types
    const { stream, response } = await ai.generateStream({
      system,
      prompt,
    });

    for await (const chunk of stream) {
      if (onChunk) {
        for (const part of chunk.content as ThinkingPart[]) {
          onChunk({ reasoning: part.reasoning, text: part.text });
        }
      }
    }

    return (await response).text.trim();
  } catch {
    // Fall back to the non-thinking variant if the streaming call fails
    const result = await ai.generate({
      system,
      prompt,
    });
    return result.text.trim();
  }
}

/**
 * Atomically deducts AI credits from a user's balance.
 * Returns the updated creditsRemaining value, or null if the user was not found.
 */
export async function deductAiCredits(
  userId: string | Types.ObjectId,
  amount: number = AI_CONFIG.CREDITS_PER_MESSAGE
): Promise<number | null> {
  return await runInTransaction(async (session: any) => {
    const updated = await User.findByIdAndUpdate(
      userId,
      { $inc: { "aiUsageStats.creditsRemaining": -amount } },
      { returnDocument: 'after', session }
    );
    return updated?.aiUsageStats?.creditsRemaining ?? null;
  });
}

