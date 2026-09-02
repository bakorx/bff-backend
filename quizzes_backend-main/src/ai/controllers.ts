import { Request, Response } from "express";
import * as services from "./services";
import * as selectors from "./selectors";
import { sendSuccess, sendError } from "@/utils";
import { AI_CONFIG } from "./config";
import { shortQueue } from "@/schedulers";

// --- AI DOMAIN CONTROLLERS ---

export const createPersona = async (req: Request, res: Response) => {
  try {
    const persona = await services.createChatbotPersona(req.body);
    sendSuccess(
      res,
      "Chatbot persona created successfully",
      persona,
      null,
      201,
    );
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getPersonas = async (req: Request, res: Response) => {
  try {
    const personas = await selectors.getActivePersonas(req.query);
    sendSuccess(res, "Chatbot personas retrieved successfully", personas);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getAllPersonas = async (req: Request, res: Response) => {
  try {
    const personas = await selectors.getAllPersonas(req.query);
    sendSuccess(res, "All chatbot personas retrieved successfully", personas);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getPersona = async (req: Request, res: Response) => {
  try {
    const persona = await selectors.getPersonaById(req.params.id as string);
    if (!persona) return sendError(res, "Persona not found", 404);
    sendSuccess(res, "Chatbot persona retrieved successfully", persona);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const saveAiResponse = async (req: Request, res: Response) => {
  try {
    const aiResponse = await services.createAiResponse(req.body);
    sendSuccess(res, "AI response recorded", aiResponse, null, 201);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getAllAiResponses = async (req: Request, res: Response) => {
  try {
    const responses = await selectors.getAllAiResponses(req.query);
    sendSuccess(res, "All AI responses retrieved successfully", responses);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getAiResponse = async (req: Request, res: Response) => {
  try {
    const response = await selectors.getAiResponseById(req.params.id as string);
    if (!response) return sendError(res, "AI response not found", 404);
    sendSuccess(res, "AI response retrieved successfully", response);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const recordAiUsage = async (req: Request, res: Response) => {
  try {
    const usage = await services.createAiUsageTransaction(req.body);
    sendSuccess(res, "AI usage transaction logged", usage, null, 201);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getAllAiUsage = async (req: Request, res: Response) => {
  try {
    const usageTransactions = await selectors.getAllTransactions(req.query);
    sendSuccess(
      res,
      "All AI usage transactions retrieved successfully",
      usageTransactions,
    );
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

export const getAiUsage = async (req: Request, res: Response) => {
  try {
    const usage = await selectors.getTransactionById(req.params.id as string);
    if (!usage) return sendError(res, "Usage transaction not found", 404);
    sendSuccess(res, "Usage transaction retrieved successfully", usage);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

// ---------------------------------------------------------------------------
// AI Chat controllers
// ---------------------------------------------------------------------------

/**
 * POST /ai/chat
 *
 * One-shot chat message — no persistent session required.
 * Useful for quick explanations, hints, and question generation.
 *
 * Body: { message, personaId?, context?, model? }
 */
export const sendChatMessage = async (req: Request, res: Response) => {
  try {
    const { message, personaId, context, model } = req.body;
    if (!message) return sendError(res, "message is required", 400);

    // Resolve persona system prompt if a personaId was supplied
    let personaPrompt: string | undefined;
    if (personaId) {
      const persona = await selectors.getPersonaById(personaId as string);
      if (persona) {
        personaPrompt = persona.systemPrompt;
        // Fire-and-forget usage count increment
        services
          .incrementPersonaUsageCount(personaId as string)
          .catch(() => {});
      }
    }

    const result = await services.sendChatMessage(
      message as string,
      [],
      { personaPrompt, context: context as string | undefined },
      model as string | undefined,
    );

    // Deduct credits from user balance and send low-credit notification if needed
    const userId = (req as any).user?._id;
    if (userId) {
      const creditsRemaining = await services.deductAiCredits(userId);
      if (
        creditsRemaining !== null &&
        creditsRemaining <= AI_CONFIG.LOW_CREDIT_THRESHOLD
      ) {
        shortQueue.enqueue("notification:ai_credits_low", {
          userId: String(userId),
          creditsRemaining,
        });
      }
    }

    sendSuccess(res, "Chat response generated", result);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};

/**
 * POST /ai/chat/sessions/:sessionId/message
 *
 * Sends a message inside a persistent StudyPartnerSession, maintains
 * conversation history, and appends both the user turn and the AI reply
 * to the session's messages array.
 *
 * Body: { message, personaId?, context?, model? }
 */
export const sendSessionChatMessage = async (req: Request, res: Response) => {
  try {
    const sessionId = String(req.params.sessionId);
    const { message, personaId, context, model } = req.body;
    if (!message) return sendError(res, "message is required", 400);

    const session = await selectors.getSessionById(sessionId);
    if (!session) return sendError(res, "Study session not found", 404);

    // Resolve persona — prefer session's active persona, then request param
    const resolvedPersonaId = personaId ?? session.activePersonaId;
    let personaPrompt: string | undefined;
    if (resolvedPersonaId) {
      const persona = await selectors.getPersonaById(String(resolvedPersonaId));
      if (persona) {
        personaPrompt = persona.systemPrompt;
        services
          .incrementPersonaUsageCount(String(resolvedPersonaId))
          .catch(() => {});
      }
    }

    // Build history from existing session messages
    const history = services.buildChatHistory(session.messages ?? []);

    const result = await services.sendChatMessage(
      message as string,
      history,
      { personaPrompt, context: context as string | undefined },
      model as string | undefined,
    );

    // Persist both turns into the session
    const userMsg = {
      senderId: (req as any).user?._id,
      content: message,
      timestamp: new Date(),
      isAI: false,
    };
    const aiMsg = {
      senderId: null, // AI-generated — no human sender
      content: result.text,
      timestamp: new Date(),
      isAI: true,
      creditsUsed: AI_CONFIG.CREDITS_PER_MESSAGE,
      personaUsed: resolvedPersonaId ?? undefined,
    };

    await services.addMessageToSession(sessionId, userMsg);
    await services.addMessageToSession(sessionId, aiMsg);

    // Deduct credits and check threshold
    const userId = (req as any).user?._id;
    if (userId) {
      const creditsRemaining = await services.deductAiCredits(userId);
      if (
        creditsRemaining !== null &&
        creditsRemaining <= AI_CONFIG.LOW_CREDIT_THRESHOLD
      ) {
        shortQueue.enqueue("notification:ai_credits_low", {
          userId: String(userId),
          creditsRemaining,
        });
      }
    }

    sendSuccess(res, "Chat response generated", result);
  } catch (error: any) {
    sendError(res, error.message, 500);
  }
};
