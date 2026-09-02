import { Types } from "mongoose";
import { StudySession } from "../models";
import { isValidObjectId } from "mongoose";
import { MemoryServices } from "../memory/services";
import { resolveSkills, buildToolsForPhase } from "../skills/registry";
import {
  Z_IDENTITY,
  buildSessionContext,
  getPhaseInstructions,
} from "../prompts";
import { ai } from "@/ai";
import { runInTransaction } from "@/utils";
import { ISessionMessage, AgentPhase } from "../interfaces";
import { nanoid } from "nanoid";
import type { SignalEmitter } from "../sse";
import { Material } from "@/learning";
import { executionContext } from "@/utils";
import { createThoughtSplitter, sanitizeChatText, cleanThoughtText } from "@/ai";
import { repairSessionMessages } from "./utils";
import { logger } from "@/config";

export interface ZFlowInput {
  sessionId?: string;
  userId: string;
  trigger:
    | "start"
    | "user_message"
    | "approve_plan"
    | "steer"
    | "resume"
    | "journey_step"
    | "continue_journey"
    | "autonomous_gen";
  payload?: Record<string, unknown>;
  emit: SignalEmitter;
  isAutonomous?: boolean;
}

export interface ZFlowResult {
  success: boolean;
  sessionId: string;
  phase: string;
  artifacts?: any[];
  error?: string;
}

const ZFLOW_MAX_TURNS_STRUCTURED = 30;
const ZFLOW_MAX_TURNS_AUTONOMOUS = 45;

export async function zFlow(input: ZFlowInput): Promise<ZFlowResult> {
  const { sessionId: initialSessionId, userId, trigger, payload, emit } = input;
  const isAutonomous = input.isAutonomous || trigger === "autonomous_gen";

  let sessionId = initialSessionId;
  try {
    const isValidId = sessionId && isValidObjectId(sessionId);
    let session = isValidId
      ? await StudySession.findById(sessionId).populate("studyPlan").lean()
      : null;

    if (!session && isAutonomous) {
      // Create a background session to maintain agentic state and allow tools to work
      const createPayload: any = {
        userId,
        name: String(payload?.taskLabel || "Autonomous Task"),
        currentPhase: "implementation",
        mode: "structured",
        planningMode: "fast",
        status: "active",
        isTransient: true,
      };

      // Copy materialIds from the source session so tools (search_materials, etc.) can access them
      if (
        payload?.materialIds &&
        Array.isArray(payload.materialIds) &&
        payload.materialIds.length > 0
      ) {
        createPayload.materialIds = payload.materialIds;
      }
      if (payload?.sourceSessionId) {
        createPayload.sourceSessionId = payload.sourceSessionId;
      }
      if (payload?.courseId) {
        createPayload.courseId = payload.courseId;
      }

      const newSession = await StudySession.create(createPayload);
      sessionId = String(newSession._id);
      session = newSession.toObject();
      input.sessionId = sessionId; // Ensure tools called later get the real ID
    }

    if (!session) {
      throw new Error(
        `Session ${sessionId} not found and task is not autonomous`,
      );
    }

    // ─── Sanitization: Fix any existing messages with invalid "tool" roles, missing content, or thought tags ─────
    await repairSessionMessages(String(sessionId), session);

    let materialContext: Array<{
      id: string;
      filename: string;
      summary?: any;
    }> = [];
    const memory = await MemoryServices.snapshot(
      String(session.userId),
      session.courseId?.toString(),
    ).catch(() => null);

    // Check if material object is passed directly from autonomous handler
    let materials: any[] = [];
    if (isAutonomous && payload?.material) {
      // Use the material object passed from handler (avoid re-fetching)
      materials = [payload.material];
    } else {
      // Fetch from database: check materialIds list, single materialId, or session's materialIds
      const targetIds =
        payload?.materialIds &&
        Array.isArray(payload.materialIds) &&
        payload.materialIds.length > 0
          ? payload.materialIds
          : (session as any).materialIds &&
              (session as any).materialIds.length > 0
            ? (session as any).materialIds
            : [];

      const materialFilter: any =
        targetIds.length > 0
          ? {
              _id: {
                $in: targetIds.map((id: any) => new Types.ObjectId(String(id))),
              },
            }
          : isAutonomous &&
              payload?.materialId &&
              isValidObjectId(payload.materialId)
            ? { _id: new Types.ObjectId(String(payload.materialId)) }
            : { sessionId: new Types.ObjectId(String(sessionId)) };

      materials = await Material.find(
        { ...materialFilter, processingStatus: "ready" },
        { filename: 1, originalName: 1, summary: 1 },
      ).lean();
    }

    materialContext = materials.map((m) => ({
      id: String((m as any)._id),
      filename: m.originalName || m.filename,
      summary: m.summary,
    }));

    const skills = resolveSkills(session as any);
    const tools = buildToolsForPhase(
      skills,
      session.currentPhase as AgentPhase,
    );
    let system =
      Z_IDENTITY +
      "\n\n" +
      (buildSessionContext(session as any, memory, materialContext) || "") +
      "\n\n" +
      (getPhaseInstructions(
        session.currentPhase,
        session.planningMode as any,
      ) || "");

    if (isAutonomous) {
      const targetMaterialId = payload?.materialId
        ? String(payload.materialId)
        : "unknown";
      const isPublicQuiz = payload?.quizPreset === "public";
      system += `\n\nAUTONOMOUS MODE: You are running in "fire and forget" mode as a background runner.
Your current sessionId is: "${sessionId}"
Your current userId is: "${userId}"
Target Material ID: "${targetMaterialId}"

STEPS:
1. Use 'search_materials' to read the material content across all topics.
2. Synthesize concepts and call 'generate_notes', 'generate_lesson', 'generate_mindmap', 'generate_flashcards', 'generate_quiz', 'generate_study_plan', or 'generate_course_summary' with non-generic titles.

CRITICAL RULES:
- DO NOT USE 'save_artifact' for flashcards, quizzes, mindmaps, study plans, or course summaries. Use the specialized generation tools directly.
- STUDY PLAN DESIGN: Use 'generate_study_plan'. Organize course materials into sequential chapters with detailed steps (topics). For each step, include 'title', 'coreIdea', 'whyItMatters', and 'prerequisites' (knowledge blocks to learn).
- COURSE SUMMARY DESIGN: Use 'generate_course_summary'. Synthesize publication-grade summaries with 'overview', 'logicalPillars', 'topicDeepDives', and 'keyTakeaways'.
- FLASHCARD MINIMUM (25): For flashcards, you MUST generate between 25 and 50 cards.
- QUIZ MINIMUM (40): For quizzes, you MUST generate at least 40 questions. 
- MINDMAP DESIGN: Use 'generate_mindmap'. You MUST synthesize a deep, hierarchical graph. 
  - Provide a descriptive 'title'.
  - 'nodes': Array of {id, label, type, parentId?, position: {x, y}}. Types: 'concept', 'topic', 'detail', 'question'.
  - 'edges': Array of {id, source, target, label?}.
  - Ensure coordinates (x, y) allow for a clear, readable tree-like layout (e.g., source at top, children below).
- QUIZ DIVERSITY: Use a diverse mix of 'mcq', 'true_false', 'short_answer', 'essay', and 'fill_in_blank' types. Mix 'easy', 'medium', and 'hard' difficulties to cover the material thoroughly.
- If you don't find enough content, search again with a different query.
- TOOL CALL JSON: Ensure all tool arguments (especially large arrays like 'concepts' or 'questions') are perfectly formatted JSON. Do not include unnecessary newlines OR markdown formatting inside the tool call.
- You MUST pass "sessionId", "userId", and "materialIds": ["${targetMaterialId}"] to every tool call.`;

      if (isPublicQuiz) {
        system += `\n\nPUBLIC QUIZ MODE:
- This is a public quiz, so prioritize objective questions that are easy to grade and broadly representative of the material.
- Use an approximate question mix of 65% mcq, 20% true_false, 10% fill_in_blank, and 5% short_answer.
- Do not use essay questions for public quizzes unless absolutely necessary.
- Generate at least 40 questions per lecture or major lecture-like section you cover.
- Keep coverage balanced across the full material, but favor the objective question types above.`;
        system += `\n- Every quiz question must include a concise hint and a clear explanation.`;
        system += `\n- When calling generate_quiz, set quizPreset to \"public\" and keep count at 40 or higher.`;
      }
    }

    const history = session.messages
      .filter(
        (m: any) =>
          m.type === "text" &&
          m.role !== "system" &&
          m.content &&
          m.content.trim().length > 0 &&
          !m.content.trim().startsWith("[STUDY JOURNEY:") &&
          !/^Give a very short.*intro welcoming me/i.test(m.content.trim()),
      )
      .slice(-30)
      .map((m: any) => ({
        role: (m.role === "z" ? "model" : "user") as "model" | "user",
        content: [{ text: m.content }],
      }));

    const userMessage = buildTriggerMessage(trigger, payload, session.name);
    const userMessageId = payload?.messageId
      ? String(payload.messageId)
      : undefined;
    const responseMessageId = nanoid();
    let fullText = "";

    const splitter = createThoughtSplitter(
      (thoughtChunk) => {
        if (emit) {
          emit({
            type: "thinking_chunk",
            sessionId: String(sessionId),
            userId,
            payload: { chunk: thoughtChunk, messageId: responseMessageId },
          });
        }
      },
      (textChunk) => {
        fullText += textChunk;
        if (emit) {
          emit({
            type: "text_chunk",
            sessionId: String(sessionId),
            userId,
            payload: { chunk: textChunk, messageId: responseMessageId },
          });
        }
      },
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await executionContext.run(
      {
        sessionId,
        userId,
        materialId: payload?.materialId
          ? String(payload.materialId)
          : undefined,
      },
      async () => {
        return await ai.generate({
          userId,
          system,
          messages: [
            ...history,
            { role: "user", content: [{ text: userMessage }] },
          ],
          tools: tools as never[],
          maxTurns: isAutonomous
            ? ZFLOW_MAX_TURNS_AUTONOMOUS
            : ZFLOW_MAX_TURNS_STRUCTURED,
          onChunk: (chunk: any) => {
            const parts = chunk.content || [];
            for (const part of parts) {
              splitter.processChunk(
                part.text,
                part.reasoning || chunk.custom?.reasoning,
              );
            }
          },
        });
      },
    );

    splitter.flush();
    fullText = sanitizeChatText(fullText);

    // Fetch citations and fresh artifact created during this generation (via tool calls).
    // Include them in text_done so the frontend can update immediately without waiting for a query refetch.
    let freshCitations: unknown[] = [];
    let freshArtifact: any = null;
    try {
      const sessionWithData = await StudySession.findById(sessionId, {
        citations: 1,
        artifacts: { $slice: -1 },
      }).lean();
      freshCitations = (sessionWithData?.citations as unknown[]) ?? [];
      const latestArt = sessionWithData?.artifacts?.[0];
      if (latestArt) {
        freshArtifact = latestArt;
      }
    } catch {
      // Non-critical — frontend will pick up citations/artifacts on next query refetch
    }

    // Check if tools were executed during this turn
    const hadToolExecution = response.messages.some(
      (m: any) =>
        m.content?.[0]?.toolCall ||
        m.content?.[0]?.toolResponse ||
        m.role === "tool",
    );

    let cleanFinalText = fullText.trim();
    // If tools were executed, enforce Hard Rule 4: chat text is strictly 1-2 sentences warm framing
    if (hadToolExecution && cleanFinalText.length > 250) {
      const sentences = cleanFinalText.split(/(?<=[.!?])\s+/);
      cleanFinalText = sentences.slice(0, 2).join(" ").trim();
    }

    if (emit) {
      emit({
        type: "thinking_done",
        sessionId: String(sessionId),
        userId,
        payload: { messageId: responseMessageId },
      });
      emit({
        type: "text_done",
        sessionId: String(sessionId),
        userId,
        payload: {
          text: cleanFinalText,
          messageId: responseMessageId,
          citations: freshCitations,
          ...(hadToolExecution && freshArtifact
            ? {
                artifact: freshArtifact,
                artifactId: freshArtifact.artifactId,
              }
            : {}),
        },
      });
    }

    const messagesToSave: ISessionMessage[] = [];

    if (cleanFinalText.length > 0) {
      const messagesList = (session.messages || []) as any[];
      const lastMsg = messagesList[messagesList.length - 1];
      const isDuplicate =
        lastMsg &&
        lastMsg.role === "z" &&
        lastMsg.content?.trim().toLowerCase() === cleanFinalText.toLowerCase();

      if (!isDuplicate) {
        const lastMsgTime =
          messagesList.length > 0
            ? new Date(messagesList[messagesList.length - 1].timestamp).getTime()
            : 0;
        const responseTimestamp = new Date(Math.max(Date.now(), lastMsgTime + 1));

        messagesToSave.push({
          messageId: responseMessageId,
          role: "z",
          content: cleanFinalText,
          type: "text",
          replyToMessageId: userMessageId,
          phase: session.currentPhase as AgentPhase,
          timestamp: responseTimestamp,
          ...(hadToolExecution && freshArtifact
            ? {
                artifactId: freshArtifact.artifactId,
                artifact: freshArtifact,
              }
            : {}),
        });
      }
    }

    if (messagesToSave.length > 0) {
      await runInTransaction(async (txSession) => {
        await StudySession.findByIdAndUpdate(
          sessionId,
          { $push: { messages: { $each: messagesToSave } } },
          { session: txSession },
        );
      });
    }
    const updatedSession = await StudySession.findById(sessionId).lean();

    // ─── Automatic Session Title Generation ──────────────────────────────────
    // trigger a background AI check to give it a better, more descriptive name.
    if (
      updatedSession &&
      updatedSession.messages.length >= 5 &&
      updatedSession.messages.length <= 10
    ) {
      // Fire and forget (optional: await if we want to confirm, but background is better for perf)
      renameSessionIfGeneric(String(sessionId), updatedSession.messages).catch(
        (err) => logger.error("[zFlow] Title generation failed:", err),
      );
    }

    return {
      success: true,
      sessionId: String(sessionId),
      phase: updatedSession?.currentPhase ?? session.currentPhase,
      artifacts: updatedSession?.artifacts || [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[zFlow] Error during flow execution:", message);
    if (emit) {
      emit({
        type: "text_chunk",
        sessionId: String(sessionId || "none"),
        userId,
        payload: { chunk: "\n\nSomething went wrong. Please try again." },
      });
      emit({
        type: "text_done",
        sessionId: String(sessionId || "none"),
        userId,
        payload: { error: message },
      });
    }
    return {
      success: false,
      sessionId: String(sessionId || "none"),
      phase: "idle",
      error: message,
    };
  }
}

export function buildTriggerMessage(
  trigger: string,
  payload: Record<string, unknown> | undefined,
  sessionName: string,
): string {
  switch (trigger) {
    case "start":
      return `Please begin the session "${sessionName}". Start with the analysis phase.`;
    case "user_message":
    case "system_action":
      return String(payload?.message ?? "");
    case "approve_plan":
      return payload?.edits
        ? `I've reviewed the plan. Here are my edits: ${JSON.stringify(payload.edits)}. Please proceed.`
        : "I approve the study plan. Please proceed.";
    case "steer":
      return `[STEERING] New instruction: ${String(payload?.instruction ?? "")}`;
    case "resume":
      return "Please resume from where we left off. Continue teaching the active topic and do not regenerate the study plan.";
    case "journey_step":
    case "continue_journey": {
      const chTitle = payload?.chapterTitle
        ? `"${payload.chapterTitle}"`
        : "the active chapter";
      const stepTitle = payload?.stepTitle
        ? `"${payload.stepTitle}"`
        : "this topic";
      const coreIdea = payload?.coreIdea
        ? ` Core intuition: "${payload.coreIdea}".`
        : "";
      const kbInfo = payload?.activeBlockTitle
        ? ` Target knowledge block: "${payload.activeBlockTitle}".`
        : "";
      return `[STUDY JOURNEY: ACTIVE TOPIC LAUNCH]
The student is continuing Chapter: ${chTitle}, Topic: ${stepTitle}.${coreIdea}${kbInfo}
As Z, take the lead to teach this topic. IMPORTANT: Do NOT regenerate the study plan.
1. Provide a short, warm, intuitive intro in chat text (strictly 1-2 sentences).
2. Call 'create_exposition' for the detailed conceptual explanation.
3. Call 'ask_question' to test their understanding interactively.
STRICT RULE: Do NOT write questions, options, or the lesson body in your chat text response.`;
    }
    case "autonomous_gen":
      return String(
        payload?.message ||
          "Please read the provided material and generate the requested study artifacts (flashcards, quiz, or mindmap) based on its content.",
      );
    default:
      return String(payload?.message ?? "Continue.");
  }
}

async function renameSessionIfGeneric(
  sessionId: string,
  messages: ISessionMessage[],
) {
  const historyText = messages
    .filter((m) => m.role === "user" || m.role === "z")
    .map((m) => `${m.role === "z" ? "Z" : "Student"}: ${m.content}`)
    .join("\n")
    .slice(0, 4000);

  const prompt = `Summarize this initial session exchange into a very short, descriptive, professional title (max 40 characters, no quotes). 
It should be in the style of a session name like "DCIT 401 Algorithm Setup" or "Photosynthesis Deep Dive".
Return ONLY the title text.

CONVERSATION:
${historyText}`;

  try {
    const response = await ai.generate({
      system:
        "You are a session title generator. Provide ONLY the title string.",
      messages: [{ role: "user", content: [{ text: prompt }] }],
      config: { temperature: 0.3, maxOutputTokens: 50 },
    });

    const rawTitle =
      response?.message?.content?.[0]?.text || response?.text || "";
    const clean = cleanThoughtText(rawTitle)
      .trim()
      .replace(/^"|"$/g, "")
      .replace(/^title:\s*/i, "");
    const title = clean ? clean.slice(0, 50) : "Revised Study Session";

    await StudySession.findByIdAndUpdate(sessionId, { name: title });
    logger.info(
      `[zFlow] Automatically renamed session ${sessionId} to "${title}"`,
    );
  } catch (error) {
    logger.error("[zFlow] Failed to auto-rename session:", error);
  }
}
