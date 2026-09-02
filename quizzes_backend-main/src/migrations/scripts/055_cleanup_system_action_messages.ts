import { Mongoose } from "mongoose";
import { logger } from "@/config";

/**
 * Migration 055: Cleanup System Actions, Intro Triggers, Tool Results, and Repeated Messages in Session Histories.
 *
 * 1. Identifies automated intro prompts and journey launch triggers, converting them to type: "system_action".
 * 2. Purges empty / orphaned tool_result, tool_call, and empty system messages.
 * 3. Deduplicates consecutive identical Z text messages caused by past tool execution loops.
 * 4. Backfills missing artifact objects on messages that have an artifactId by resolving from session.artifacts.
 * 5. Strips lingering <think> tags from message content.
 */
export async function up(mongoose: Mongoose) {
  logger.info("Starting migration: 055_cleanup_system_action_messages...");

  const db = mongoose.connection.db;
  if (!db) throw new Error("No active DB connection");

  const sessionsCollection = db.collection("studysessions");
  const cursor = sessionsCollection.find({
    "messages.0": { $exists: true },
  });

  let totalSessionsChecked = 0;
  let totalSessionsModified = 0;
  let totalMessagesCleaned = 0;

  const INTRO_REGEX = /^Give a very short.*intro welcoming me/i;
  const JOURNEY_REGEX = /^\[STUDY JOURNEY:/i;
  const CLEAN_THINK_REGEX = /<think>[\s\S]*?<\/think>/gi;

  while (await cursor.hasNext()) {
    const session = await cursor.next();
    if (!session || !Array.isArray(session.messages)) continue;

    totalSessionsChecked++;
    let modified = false;

    const originalMessages = session.messages;
    const artifactsList: any[] = Array.isArray(session.artifacts)
      ? session.artifacts
      : [];
    const artifactsMap = new Map<string, any>();
    for (const art of artifactsList) {
      if (art && art.artifactId) {
        artifactsMap.set(art.artifactId, art);
      }
    }

    const cleanedMessages: any[] = [];

    for (let i = 0; i < originalMessages.length; i++) {
      const m = originalMessages[i];
      if (!m) continue;

      let content = typeof m.content === "string" ? m.content : "";
      if (content.includes("<think>")) {
        content = content.replace(CLEAN_THINK_REGEX, "").trim();
        modified = true;
      }

      // Check if this message is an automated intro prompt or journey launch trigger
      const isIntroTrigger =
        INTRO_REGEX.test(content.trim()) || JOURNEY_REGEX.test(content.trim());
      const isContinuationTrigger =
        (content.trim() === "Continue" || content.trim() === "Keep going") &&
        m.role === "user" &&
        m.type === "system_action";

      // 1. Convert intro / journey triggers to type: "system_action"
      if (isIntroTrigger && m.type !== "system_action") {
        m.type = "system_action";
        modified = true;
      }

      // 2. Filter out empty tool_result / tool_call / empty system messages
      if (
        (m.type === "tool_result" ||
          m.type === "tool_call" ||
          m.role === "tool" ||
          (m.role === "system" && m.type !== "directive")) &&
        (!content || content.trim() === "" || content === " ")
      ) {
        modified = true;
        totalMessagesCleaned++;
        continue; // Skip saving this empty tool/system message
      }

      // 3. Backfill artifact object if missing on artifact message
      if (m.type === "artifact" && m.artifactId && !m.artifact) {
        const foundArtifact = artifactsMap.get(m.artifactId);
        if (foundArtifact) {
          m.artifact = foundArtifact;
          modified = true;
        }
      }

      // 4. Deduplicate consecutive identical "z" text messages
      if (
        m.role === "z" &&
        m.type === "text" &&
        cleanedMessages.length > 0
      ) {
        const prev = cleanedMessages[cleanedMessages.length - 1];
        if (
          prev.role === "z" &&
          prev.type === "text" &&
          prev.content.trim() === content.trim() &&
          content.trim().length > 0
        ) {
          modified = true;
          totalMessagesCleaned++;
          continue; // Skip duplicate consecutive message
        }
      }

      m.content = content || " ";
      cleanedMessages.push(m);
    }

    if (modified || cleanedMessages.length !== originalMessages.length) {
      await sessionsCollection.updateOne(
        { _id: session._id },
        {
          $set: {
            messages: cleanedMessages,
          },
        },
      );
      totalSessionsModified++;
    }
  }

  logger.info(
    `Migration 055 complete. Checked ${totalSessionsChecked} sessions, modified ${totalSessionsModified} sessions, cleaned ${totalMessagesCleaned} redundant messages.`,
  );
}

export async function down(mongoose: Mongoose) {
  logger.info("Rollback 055: No-op.");
}
