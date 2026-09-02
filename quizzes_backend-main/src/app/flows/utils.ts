import { StudySession } from "../models";
import { logger } from "@/config";
import { cleanThoughtText } from "@/ai";
import { maskId } from "@/utils";

/**
 * Sanitizes and repairs session message histories:
 * 1. Normalizes legacy/invalid roles ('tool' -> 'system', 'assistant' -> 'z').
 * 2. Ensures no empty content strings that violate schema validation on $push.
 * 3. Strips any lingering thought tags (<think>...</think>) from legacy session messages.
 * 4. Persists the repaired array to MongoDB if changes were needed.
 */
export async function repairSessionMessages(
  sessionId: string,
  session: { messages?: any[]; artifacts?: any[] },
): Promise<void> {
  if (!session || !Array.isArray(session.messages)) return;

  const INTRO_REGEX = /^Give a very short.*intro welcoming me/i;
  const JOURNEY_REGEX = /^\[STUDY JOURNEY:/i;

  let needsRepair = false;
  const artifactsMap = new Map<string, any>();
  if (Array.isArray(session.artifacts)) {
    for (const art of session.artifacts) {
      if (art?.artifactId) artifactsMap.set(art.artifactId, art);
    }
  }

  const cleanedMessages: any[] = [];

  for (let idx = 0; idx < session.messages.length; idx++) {
    const m = session.messages[idx];
    if (!m) continue;

    let modified = false;
    const updates: any = {};

    if (m.role === "tool") {
      updates.role = "system";
      modified = true;
    }
    if (m.role === "assistant") {
      updates.role = "z";
      modified = true;
    }

    let content = typeof m.content === "string" ? m.content : "";
    if (content.includes("<think>")) {
      content = cleanThoughtText(content) || " ";
      updates.content = content;
      modified = true;
    } else if (!m.content && m.content !== " ") {
      updates.content = " ";
      modified = true;
    }

    // Tag automated intro prompts and journey triggers as system_action
    if (
      (INTRO_REGEX.test(content.trim()) || JOURNEY_REGEX.test(content.trim())) &&
      m.type !== "system_action"
    ) {
      updates.type = "system_action";
      modified = true;
    }

    // Drop empty tool_result or tool_call messages
    const currentType = updates.type || m.type;
    const currentRole = updates.role || m.role;
    if (
      (currentType === "tool_result" ||
        currentType === "tool_call" ||
        (currentRole === "system" && currentType !== "directive")) &&
      (!content || content.trim() === "" || content === " ")
    ) {
      needsRepair = true;
      continue;
    }

    // Backfill artifact if missing
    if (currentType === "artifact" && m.artifactId && !m.artifact) {
      const found = artifactsMap.get(m.artifactId);
      if (found) {
        updates.artifact = found;
        modified = true;
      }
    }

    const mergedMsg = modified ? { ...m, ...updates } : m;

    // Deduplicate consecutive identical Z text messages
    if (
      mergedMsg.role === "z" &&
      mergedMsg.type === "text" &&
      cleanedMessages.length > 0
    ) {
      const prev = cleanedMessages[cleanedMessages.length - 1];
      if (
        prev.role === "z" &&
        prev.type === "text" &&
        prev.content?.trim() === mergedMsg.content?.trim() &&
        mergedMsg.content?.trim().length > 0
      ) {
        needsRepair = true;
        continue;
      }
    }

    if (modified) {
      needsRepair = true;
    }

    cleanedMessages.push(mergedMsg);
  }

  if (needsRepair || cleanedMessages.length !== session.messages.length) {
    session.messages = cleanedMessages;
    await StudySession.findByIdAndUpdate(sessionId, {
      $set: { messages: cleanedMessages },
    });
    logger.info(
      `[repairSessionMessages] Repaired message history in session ${maskId(sessionId)}`,
    );
  }
}
