import { StudySession } from "../models";
import { isValidObjectId } from "mongoose";
import { resolveSkills, buildToolsForPhase } from "../skills/registry";
import { Z_IDENTITY, buildSessionContext } from "../prompts";
import { ai } from "@/ai/config";
import { runInTransaction } from "@/utils";
import { ISessionMessage } from "../interfaces";
import { nanoid } from "nanoid";
import type { SignalEmitter } from "../sse";
import { MemoryServices } from "../memory/services";
import { Material } from "@/learning";
import { executionContext } from "@/utils";
import { logger } from "@/config";
import { createThoughtSplitter, cleanThoughtText } from "@/ai";
import { repairSessionMessages } from "./utils";

export interface FreeFlowInput {
  sessionId: string;
  userId: string;
  message: string;
  userMessageId?: string;
  emit: SignalEmitter;
}

export interface FreeFlowResult {
  success: boolean;
  sessionId: string;
  error?: string;
}

export async function freeFlow(input: FreeFlowInput): Promise<FreeFlowResult> {
  const { sessionId, userId, message, userMessageId, emit } = input;
  try {
    if (!isValidObjectId(sessionId)) {
      throw new Error(`Invalid sessionId: ${sessionId}`);
    }
    const session = await StudySession.findById(sessionId).lean();
    if (!session) throw new Error("Session not found");

    // ─── Sanitization: Fix any existing messages with invalid roles, missing content, or thought tags ─────
    await repairSessionMessages(sessionId, session);

    const memory = await MemoryServices.snapshot(
      String(session.userId),
      session.courseId?.toString(),
    );
    const materials = await Material.find(
      { sessionId, processingStatus: "ready" },
      { filename: 1 },
    ).lean();
    const materialContext = materials.map((m) => ({
      id: String((m as any)._id),
      filename: m.filename,
    }));

    const skills = resolveSkills(session);
    const tools = buildToolsForPhase(skills, "idle");

    const system =
      Z_IDENTITY +
      "\n\nYou are in free exploration mode — help the student with whatever they need.\n\n" +
      buildSessionContext(session, memory, materialContext);

    const history = session.messages
      .filter(
        (m) => m.type === "text" && m.content && m.content.trim().length > 0,
      )
      .slice(-20)
      .map((m) => ({
        role: (m.role === "z" ? "model" : "user") as "model" | "user",
        content: [{ text: m.content }],
      }));

    const responseMessageId = nanoid();
    let fullText = "";

    const splitter = createThoughtSplitter(
      (thoughtChunk) => {
        if (emit) {
          emit({
            type: "thinking_chunk",
            sessionId,
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
            sessionId,
            userId,
            payload: { chunk: textChunk, messageId: responseMessageId },
          });
        }
      },
    );

    const response = await executionContext.run(
      { sessionId, userId },
      async () => {
        return await ai.generate({
          userId,
          system,
          messages: [
            ...history,
            { role: "user", content: [{ text: message }] },
          ],
          tools: tools as never[],
          maxTurns: 10,
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
    fullText = cleanThoughtText(fullText);

    if (emit) {
      emit({
        type: "thinking_done",
        sessionId,
        userId,
        payload: { messageId: responseMessageId },
      });
      emit({
        type: "text_done",
        sessionId,
        userId,
        payload: { text: fullText, messageId: responseMessageId },
      });
    }

    // ── Persistence: save all new interactions (text + tool calls/results) ────────
    const newMessagesFromAI = response.messages.slice(history.length + 1); // skip history + current user message

    const messagesToSave: ISessionMessage[] = newMessagesFromAI.map(
      (m: any, idx: number) => {
        const isLastText = idx === newMessagesFromAI.length - 1 && fullText;

        let mappedRole: "user" | "z" | "system" | "peer" = "system";
        if (m.role === "user") mappedRole = "user";
        else if (m.role === "model" || m.role === "assistant") mappedRole = "z";
        else if (m.role === "system") mappedRole = "system";
        else if (m.role === "tool") mappedRole = "system";

        const rawContent = m.content?.[0]?.text
          ? m.content[0].text
          : m.role === "model"
            ? fullText || " "
            : " ";
        const cleanContent = cleanThoughtText(rawContent);

        return {
          messageId: isLastText ? responseMessageId : nanoid(),
          role: mappedRole,
          content: cleanContent || " ",
          type: m.content?.[0]?.toolCall
            ? "tool_call"
            : m.content?.[0]?.toolResponse
              ? "tool_result"
              : "text",
          toolCall: m.content?.[0]?.toolCall,
          toolResult: m.content?.[0]?.toolResponse,
          replyToMessageId: isLastText ? userMessageId : undefined,
          phase: "idle",
          timestamp: new Date(),
        };
      },
    );

    if (messagesToSave.length > 0) {
      logger.info(
        `[freeFlow] Saving ${messagesToSave.length} new messages for session ${sessionId}.`,
      );
      await runInTransaction(async (txSession) => {
        await StudySession.findByIdAndUpdate(
          sessionId,
          { $push: { messages: { $each: messagesToSave } } },
          { session: txSession },
        );
      });
    }

    return { success: true, sessionId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "text_done", sessionId, userId, payload: { error: message } });
    return { success: false, sessionId, error: message };
  }
}
