/**
 * tool-context.ts
 *
 * Problem: Genkit's `ai.defineTool()` registers each tool in a **global**
 * in-process registry.  When multiple BullMQ workers share the same Node.js
 * process (see src/worker.ts) they all import the same skill modules, and the
 * same tool names would be registered twice — causing a runtime error like
 * "Tool <name> cannot be defined again".
 *
 * Solution — two small helpers:
 *
 * 1. `defineToolOnce(def, handler)`
 *    Wraps `ai.defineTool()` with a module-level cache keyed on the tool name.
 *    The first call registers the tool normally; every subsequent call (same
 *    process, any number of workers) returns the cached `ToolAction` without
 *    touching Genkit's registry.  The raw `handler` is also stored so that
 *    `runToolWithContext` can invoke it directly.
 *
 * 2. `runToolWithContext(toolName, input)`
 *    Calls the registered handler function **directly**, bypassing Genkit's
 *    tool-dispatch pipeline.  Use this when you need to exercise a tool from
 *    a standalone worker that has no active `ai.generate()` call in scope
 *    (e.g. the appMindMap or appGenerate workers).
 */

import { z } from "genkit";
import { ai } from "@/ai/config";
import { StudySession } from "../models";
import { isValidObjectId } from "mongoose";
import { executionContext } from "@/utils";
import { logger } from "@/config";

/**
 * Resolve the skill context from the tool input.
 * Supports both sessionId-based (backward compatible) and direct userId/courseId inputs.
 */
export async function resolveSkillContext(input: any) {
  let { sessionId, userId, courseId, materialIds } = input;

  // Normalize null to undefined for TypeScript compatibility
  sessionId = sessionId ?? undefined;
  userId = userId ?? undefined;
  courseId = courseId ?? undefined;
  materialIds = materialIds ?? undefined;

  // 1. Fetch the trusted context from the execution store (managed by the flow runner)
  const context = executionContext.getStore();
  const contextSessionId = context?.sessionId;
  const contextUserId = context?.userId;

  // Treat model-provided invalid session IDs as untrusted and prefer flow context.
  if (sessionId && !isValidObjectId(sessionId)) {
    if (contextSessionId && isValidObjectId(contextSessionId)) {
      logger.info(
        `[Context] Ignoring invalid tool sessionId "${sessionId}". Using execution context session ${contextSessionId}.`,
      );
      sessionId = contextSessionId;
    } else {
      logger.info(
        `[Context] Ignoring invalid tool sessionId "${sessionId}" with no valid execution context fallback.`,
      );
      sessionId = undefined;
    }
  }

  // 2. PRIORITIZE: If the execution context has a valid session/user, use them
  // especially if the model provided no ID.
  if (!sessionId && contextSessionId) {
    sessionId = contextSessionId;
  }

  if (!userId && contextUserId) {
    userId = contextUserId;
  }

  const resolvedMaterialIds =
    materialIds && materialIds.length > 0
      ? materialIds
      : context?.materialId
        ? [context.materialId]
        : [];

  // 3. Validate and load the session if available
  if (sessionId && isValidObjectId(sessionId)) {
    const session = await StudySession.findById(sessionId).lean();
    if (session) {
      const targetSessionId =
        session.isTransient && (session as any).sourceSessionId
          ? String((session as any).sourceSessionId)
          : sessionId;

      const targetMaterialIds =
        resolvedMaterialIds.length > 0
          ? resolvedMaterialIds
          : ((session as any).materialIds || []).map(String);

      return {
        session,
        userId: String(session.userId),
        courseId: session.courseId?.toString(),
        sessionId: targetSessionId,
        materialIds: targetMaterialIds,
      };
    } else {
      // If the provided ID is not found, attempt fallback to context if it's different and valid
      if (
        contextSessionId &&
        contextSessionId !== sessionId &&
        isValidObjectId(contextSessionId)
      ) {
        logger.info(
          `[Context] Session ${sessionId} not found. Falling back to context session ${contextSessionId}.`,
        );
        const contextSession =
          await StudySession.findById(contextSessionId).lean();
        if (contextSession) {
          const targetSessionId =
            contextSession.isTransient && (contextSession as any).sourceSessionId
              ? String((contextSession as any).sourceSessionId)
              : contextSessionId;

          const targetMaterialIds =
            resolvedMaterialIds.length > 0
              ? resolvedMaterialIds
              : ((contextSession as any).materialIds || []).map(String);

          return {
            session: contextSession,
            userId: String(contextSession.userId),
            courseId: contextSession.courseId?.toString(),
            sessionId: targetSessionId,
            materialIds: targetMaterialIds,
          };
        }
      }
      logger.info(
        `[Context] Session ${sessionId} provided but not found in DB.`,
      );
    }
  }

  if (!userId && !sessionId) {
    logger.error(
      `[Context] Missing both userId and sessionId in tool input:`,
      input,
    );
  }

  return {
    userId,
    courseId: courseId,
    sessionId: sessionId,
    materialIds: resolvedMaterialIds,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (input: any) => Promise<any>;

// Tools that have been successfully registered with Genkit
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _toolCache = new Map<string, any>();

// Raw async handler functions, stored separately so we can call them directly
const _handlerCache = new Map<string, AnyHandler>();

/**
 * Define a Genkit tool exactly once per process, regardless of how many
 * times the module is imported or how many workers are running.
 *
 * Signature is intentionally identical to `ai.defineTool()` so callers can
 * swap `ai.defineTool` → `defineToolOnce` without changing anything else.
 */
export function defineToolOnce<I extends z.ZodTypeAny = z.ZodTypeAny, O = any>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  def: Omit<Parameters<typeof ai.defineTool>[0], "inputSchema"> & {
    inputSchema?: I;
  },
  handler: (input: I extends z.ZodTypeAny ? z.infer<I> : unknown) => Promise<O>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const { name } = def as { name: string };

  // Handler cache is always updated so callers get the freshest implementation
  _handlerCache.set(name, handler as AnyHandler);

  if (_toolCache.has(name)) {
    return _toolCache.get(name)!;
  }

  try {
    const tool = ai.defineTool(def, handler as never);
    _toolCache.set(name, tool);
    return tool;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Gracefully handle a race where another import path registered the tool
    // just before we did (shouldn't happen in Node.js single-thread but guards
    // against edge-cases in test environments / module re-evaluation).
    if (
      msg.includes("already") ||
      msg.includes("defined") ||
      msg.includes("duplicate")
    ) {
      return _toolCache.get(name);
    }
    throw err;
  }
}

/**
 * Run a tool handler directly, without going through Genkit's
 * tool-dispatch pipeline.
 *
 * Useful in standalone workers where there is no active `ai.generate()` call
 * but you still want to reuse the same business logic defined in a skill file.
 *
 * Throws if the tool has never been registered in this process — ensure the
 * relevant skill module has been imported before calling this.
 */
export async function runToolWithContext<I = unknown, O = unknown>(
  toolName: string,
  input: I,
): Promise<O> {
  const handler = _handlerCache.get(toolName);
  if (!handler) {
    throw new Error(
      `runToolWithContext: no handler registered for tool "${toolName}". ` +
        `Make sure the skill module that defines this tool has been imported ` +
        `in the current process before invoking runToolWithContext.`,
    );
  }
  return handler(input) as Promise<O>;
}
