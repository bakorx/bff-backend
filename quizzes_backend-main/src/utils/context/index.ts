import { AsyncLocalStorage } from "async_hooks";

export interface IExecutionContext {
  sessionId?: string;
  userId?: string;
  materialId?: string;
}

/**
 * Global storage to maintain agentic execution context (sessionId, userId)
 * across asynchronous tool calls triggered by Genkit.
 */
export const executionContext = new AsyncLocalStorage<IExecutionContext>();
