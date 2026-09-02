import { ENV } from "@/config/env";
import { logger } from "@/config/logger";
import { selectors } from "@/users";
import { services as featureFlagServices } from "@/features";
import {
  OPENROUTER_FREE_MODELS,
  GOOGLE_FREE_MODELS,
  GROQ_FREE_MODELS,
  OPENROUTER_PAID_MODELS,
  GOOGLE_PAID_MODELS,
  GROQ_PAID_MODELS,
} from "./constants";

/**
 * Normalizes model names to include proper Genkit provider prefix.
 * Ensures Genkit automatically routes to the appropriate plugin (openAI, googleAI, or groq).
 */
export function normalizeModelName(model: string): string {
  if (!model) return model;
  if (
    model.startsWith("googleai/") ||
    model.startsWith("groq/") ||
    model.startsWith("openai/")
  ) {
    return model;
  }
  if (model.startsWith("gemini-")) {
    return `googleai/${model}`;
  }
  if (
    model.startsWith("llama") ||
    model.startsWith("qwen") ||
    model.startsWith("gemma") ||
    model.startsWith("gpt-oss") ||
    model.startsWith("deepseek")
  ) {
    return `groq/${model}`;
  }
  return `openai/${model}`;
}

/**
 * Single unified builder for model rotation chains.
 * Follows provider hierarchy (openrouter -> google -> groq, with selected provider placed first).
 * Combines paid models with automatic failover to free models if isPaid or isFreeUsersPaid is true.
 */
export function buildTierModels(options?: {
  provider?: string;
  isPaid?: boolean;
  isFreeUsersPaid?: boolean;
}): string[] {
  const provider = options?.provider || ENV.AI_PROVIDER;
  const isPaid = options?.isPaid ?? false;
  const isFreeUsersPaid =
    options?.isFreeUsersPaid ?? ENV.AI_ALLOW_FREE_USER_PAID_MODELS;

  const shouldUsePaid = isPaid || isFreeUsersPaid;

  let orderedFreeGroups: string[][];
  let orderedPaidGroups: string[][];

  if (provider === "google") {
    // google -> openrouter -> groq
    orderedFreeGroups = [GOOGLE_FREE_MODELS, OPENROUTER_FREE_MODELS, GROQ_FREE_MODELS];
    orderedPaidGroups = [GOOGLE_PAID_MODELS, OPENROUTER_PAID_MODELS, GROQ_PAID_MODELS];
  } else if (provider === "groq") {
    // groq -> openrouter -> google
    orderedFreeGroups = [GROQ_FREE_MODELS, OPENROUTER_FREE_MODELS, GOOGLE_FREE_MODELS];
    orderedPaidGroups = [GROQ_PAID_MODELS, OPENROUTER_PAID_MODELS, GOOGLE_PAID_MODELS];
  } else {
    // openrouter -> google -> groq (default)
    orderedFreeGroups = [OPENROUTER_FREE_MODELS, GOOGLE_FREE_MODELS, GROQ_FREE_MODELS];
    orderedPaidGroups = [OPENROUTER_PAID_MODELS, GOOGLE_PAID_MODELS, GROQ_PAID_MODELS];
  }

  const freeModels = orderedFreeGroups.flat().filter((v, i, a) => a.indexOf(v) === i);

  if (!shouldUsePaid) {
    return freeModels;
  }

  const paidModels = orderedPaidGroups.flat().filter((v, i, a) => a.indexOf(v) === i);
  return [...paidModels, ...freeModels].filter((v, i, a) => a.indexOf(v) === i);
}

export const FREE_TIER_MODELS: string[] = buildTierModels({ isPaid: false });
export const PAID_TIER_MODELS: string[] = buildTierModels({ isPaid: true });

/**
 * Checks if a user is subscribed via users selector.
 */
export async function checkUserSubscription(userId?: string): Promise<boolean> {
  if (!userId) return false;
  try {
    const user = await selectors.getUserById(userId);
    return Boolean(user?.isSubscribed);
  } catch {
    return false;
  }
}

/**
 * Resolves the model chain based on feature flags, env fallbacks, user tier, and emergency overrides.
 */
export async function resolveModelChainForUser(options?: {
  userId?: string;
  isSubscribed?: boolean;
  model?: string;
  provider?: string;
  tierOverride?: "auto" | "free" | "paid";
  allowFreeUserPaid?: boolean;
}): Promise<string[]> {
  const flags = await featureFlagServices.getAIFeatureFlags();

  const provider = options?.provider || flags.provider || ENV.AI_PROVIDER;
  const tierOverride =
    options?.tierOverride || flags.tierOverride || ENV.AI_TIER_OVERRIDE;
  const allowFreeUserPaid =
    options?.allowFreeUserPaid ??
    flags.allowFreeUserPaid ??
    ENV.AI_ALLOW_FREE_USER_PAID_MODELS;

  // 1. Emergency override: if tierOverride is "free", force all users to Free models
  if (tierOverride === "free") {
    return buildTierModels({ provider, isPaid: false, isFreeUsersPaid: false });
  }

  // 2. Determine if user has active subscription
  let isSubscribed = options?.isSubscribed;
  if (isSubscribed === undefined && options?.userId) {
    isSubscribed = await checkUserSubscription(options.userId);
  }

  // 3. If subscribed -> gets Paid models
  if (isSubscribed) {
    return buildTierModels({ provider, isPaid: true });
  }

  // 4. Free / unsubscribed user: gets Paid models ONLY if isFreeUsersPaid is true
  return buildTierModels({
    provider,
    isPaid: Boolean(allowFreeUserPaid),
  });
}

/**
 * Resilient wrapper: automatically resolves user tier and falls back across models and providers if rate limits or quota errors occur.
 */
export async function generateWithRetryFallback(
  generateFn: (options: any) => Promise<any>,
  options: any,
): Promise<any> {
  const userId = options.userId || options.context?.userId;
  const isSubscribed = options.isSubscribed ?? options.context?.isSubscribed;

  const tierChain = await resolveModelChainForUser({
    userId,
    isSubscribed,
    model: options.model,
  });

  const modelChain = [
    options.model ? normalizeModelName(options.model) : undefined,
    ...tierChain,
  ].filter((v, i, a): v is string => Boolean(v) && a.indexOf(v) === i);

  let lastError: any = null;

  for (let i = 0; i < modelChain.length; i++) {
    const model = modelChain[i];
    try {
      return await generateFn({
        ...options,
        model,
      });
    } catch (error: any) {
      lastError = error;
      const errorMsg = String(error?.message || error || "");
      const isTransient =
        errorMsg.includes("429") ||
        errorMsg.includes("quota") ||
        errorMsg.includes("RESOURCE_EXHAUSTED") ||
        errorMsg.includes("Too Many Requests") ||
        errorMsg.includes("402") ||
        errorMsg.includes("credits") ||
        errorMsg.includes("503") ||
        errorMsg.includes("UNAVAILABLE") ||
        errorMsg.includes("closed network connection") ||
        errorMsg.includes("ECONNRESET") ||
        errorMsg.includes("ETIMEDOUT") ||
        errorMsg.includes("socket hang up") ||
        errorMsg.includes("fetch failed") ||
        errorMsg.includes("network connection");

      logger.warn(
        `[AI] Model ${model} encountered an issue (${errorMsg.slice(0, 120)}...). Trying next available model in rotation...`,
      );

      // Brief backoff before rotating to give quota window or network a moment to refresh
      if (isTransient && i < modelChain.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
  }

  throw lastError;
}

export interface StagedGenerateOptions {
  userId?: string;
  isSubscribed?: boolean;
  model?: string;
  context?: {
    userId?: string;
    isSubscribed?: boolean;
  };
  [key: string]: any;
}

export interface StagedGenerateHandlers {
  /** Called by generateFn for every chunk of this attempt. Buffered only — not persisted. */
  onChunk?: (text?: string, reasoning?: string) => void;
  /** Called exactly once, only after a model attempt fully succeeds, with the complete buffered text. */
  onCommit: (fullText: string, model: string) => void | Promise<void>;
}

/**
 * Same model-rotation logic as generateWithRetryFallback, but stages
 * output per attempt so a transient failure can never leave partial
 * content committed to the message store.
 */
export async function generateWithStagedFallback(
  generateFn: (options: any) => Promise<any>,
  options: StagedGenerateOptions,
  handlers: StagedGenerateHandlers,
): Promise<{ text: string; model: string }> {
  const userId = options.userId || options.context?.userId;
  const isSubscribed = options.isSubscribed ?? options.context?.isSubscribed;

  const tierChain = await resolveModelChainForUser({
    userId,
    isSubscribed,
    model: options.model,
  });

  const modelChain = [
    options.model ? normalizeModelName(options.model) : undefined,
    ...tierChain,
  ].filter((v, i, a): v is string => Boolean(v) && a.indexOf(v) === i);

  let lastError: any = null;

  for (let i = 0; i < modelChain.length; i++) {
    const model = modelChain[i];

    // Fresh buffer per attempt. Nothing here touches the message store.
    let buffer = "";
    const localOnChunk = (chunkOrText: any, reasoning?: string) => {
      let text = "";
      let r = reasoning;
      if (typeof chunkOrText === "string") {
        text = chunkOrText;
      } else if (chunkOrText?.content) {
        text = chunkOrText.content.map((p: any) => p.text || "").join("");
        r = r || chunkOrText.custom?.reasoning;
      }
      if (text) buffer += text;
      handlers.onChunk?.(text, r);
    };

    try {
      await generateFn({
        ...options,
        model,
        onChunk: localOnChunk,
      });

      // Only reachable on full success for THIS attempt — commit once.
      await handlers.onCommit(buffer, model);
      return { text: buffer, model };
    } catch (error: any) {
      lastError = error;
      const errorMsg = String(error?.message || error || "");
      const isTransient =
        errorMsg.includes("429") ||
        errorMsg.includes("quota") ||
        errorMsg.includes("RESOURCE_EXHAUSTED") ||
        errorMsg.includes("Too Many Requests") ||
        errorMsg.includes("402") ||
        errorMsg.includes("credits") ||
        errorMsg.includes("503") ||
        errorMsg.includes("UNAVAILABLE") ||
        errorMsg.includes("closed network connection") ||
        errorMsg.includes("ECONNRESET") ||
        errorMsg.includes("ETIMEDOUT") ||
        errorMsg.includes("socket hang up") ||
        errorMsg.includes("fetch failed") ||
        errorMsg.includes("network connection");

      logger.warn(
        `[AI] Model ${model} failed after buffering ${buffer.length} chars (${errorMsg.slice(0, 120)}...). Discarding partial output, trying next model...`,
      );

      if (isTransient && i < modelChain.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
  }

  throw lastError;
}

export interface ThoughtSplitter {
  processChunk: (text?: string, reasoning?: string) => void;
  flush: () => void;
}

/**
 * Functional factory for stream thought splitting without OOP/classes.
 */
export function createThoughtSplitter(
  onThought: (thought: string) => void,
  onText: (text: string) => void,
): ThoughtSplitter {
  let inThinkTag = false;
  let buffer = "";

  const processChunk = (text?: string, reasoning?: string): void => {
    // 1. Explicit reasoning channel
    if (reasoning) {
      onThought(reasoning);
    }

    if (!text) return;
    buffer += text;

    // 2. Tag-based thinking (<think>...</think>)
    while (buffer.length > 0) {
      if (!inThinkTag) {
        const thinkStartIdx = buffer.indexOf("<think>");
        if (thinkStartIdx === -1) {
          // Check for partial '<think' token at the end of the buffer across stream chunks
          const partialMatch = buffer.match(/<t?(h?(i?(n?(k?)?)?)?)?$/);
          if (
            partialMatch &&
            partialMatch.index !== undefined &&
            partialMatch[0].length > 0 &&
            partialMatch.index > 0
          ) {
            const emitText = buffer.slice(0, partialMatch.index);
            buffer = buffer.slice(partialMatch.index);
            if (emitText) onText(emitText);
            break;
          } else if (partialMatch && partialMatch.index === 0) {
            // Buffer starts with partial match, await more chunk data
            break;
          }
          onText(buffer);
          buffer = "";
        } else {
          const before = buffer.slice(0, thinkStartIdx);
          if (before) onText(before);
          inThinkTag = true;
          buffer = buffer.slice(thinkStartIdx + 7);
        }
      } else {
        const thinkEndIdx = buffer.indexOf("</think>");
        if (thinkEndIdx === -1) {
          // Check for partial '</think' token at the end of the buffer
          const partialMatch = buffer.match(/<\/?t?(h?(i?(n?(k?)?)?)?)?>?$/);
          if (
            partialMatch &&
            partialMatch.index !== undefined &&
            partialMatch[0].length > 0 &&
            partialMatch.index > 0
          ) {
            const emitThought = buffer.slice(0, partialMatch.index);
            buffer = buffer.slice(partialMatch.index);
            if (emitThought) onThought(emitThought);
            break;
          } else if (partialMatch && partialMatch.index === 0) {
            break;
          }
          onThought(buffer);
          buffer = "";
        } else {
          const thought = buffer.slice(0, thinkEndIdx);
          if (thought) onThought(thought);
          inThinkTag = false;
          buffer = buffer.slice(thinkEndIdx + 8);
        }
      }
    }
  };

  const flush = (): void => {
    if (buffer) {
      if (inThinkTag) {
        onThought(buffer);
      } else {
        onText(buffer);
      }
      buffer = "";
    }
  };

  return { processChunk, flush };
}

/**
 * Pure utility function to strip lingering <think> tags (both closed and unclosed) from complete text strings.
 */
export function cleanThoughtText(raw?: string): string {
  if (!raw) return "";
  let text = raw;
  // 1. Remove closed think blocks
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  // 2. Remove unclosed think blocks (cut off at token limit)
  text = text.replace(/<think>[\s\S]*$/gi, "");
  // 3. Remove leading closing tag if start was cut off
  text = text.replace(/^[\s\S]*?<\/think>/gi, "");
  return text.trim();
}

const ID_LIKE = /\b[a-zA-Z0-9_-]{15,}\b/g;

const META_VOCAB = [
  "session",
  "sessionid",
  "goalid",
  "artifactid",
  "artifact",
  "tool",
  "toolcall",
  "phase",
  "study plan",
  "generate_study_plan",
  "set_goal_status",
  "check_interrupt",
  "emit_directive",
  "knowledge block",
  "courseid",
  "we need to",
  "we have no",
  "let's see",
  "let's examine",
  "let's outline",
  "i will call",
  "i will now",
  "i need to call",
  "calling ",
  "let me check",
  "the instructions say",
  "the tool description",
  "maybe we need",
  "we could",
  "alternatively",
  "let's re-evaluate",
  "let's think about",
];

function leakScore(paragraph: string): number {
  const lower = paragraph.toLowerCase();
  let score = 0;

  // ID-like tokens are a strong signal — students never see raw IDs.
  const idMatches = paragraph.match(ID_LIKE) || [];
  score += idMatches.length * 2;

  // Meta vocabulary density.
  for (const term of META_VOCAB) {
    if (lower.includes(term)) score += 1;
  }

  // Long paragraphs (>400 chars) reasoning through options are almost
  // never legitimate chat text — chat text is capped at 1-2 sentences.
  if (paragraph.length > 400) score += 1;

  return score;
}

const LEAK_THRESHOLD = 2;

/**
 * Detects a "question + options" block structurally instead of by option
 * punctuation alone: a line ending in "?" (or containing a recognizable
 * quiz stem) followed by 2+ short consecutive lines. Handles option lists
 * that skip "A)"/"1." formatting entirely.
 */
function stripQuestionBlocks(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    const looksLikeStem =
      /\?\s*$/.test(trimmed) ||
      /^(question|quiz|what is|which of|select|choose|true or false)/i.test(
        trimmed,
      );

    if (looksLikeStem) {
      // Look ahead: count consecutive short "option-shaped" lines
      let j = i + 1;
      let shortRun = 0;
      while (j < lines.length) {
        const t = lines[j].trim();
        if (!t) {
          j++;
          continue;
        }
        const isShortStandalone =
          t.length > 0 && t.length <= 80 && !/[.!?]\s*$/.test(t);
        const isOptionMarked =
          /^[-*•]?\s*([A-Da-d][).:]|[1-4][).:])/.test(t) ||
          /^[-*•]?\s*\[[A-Da-d]\]/.test(t);
        if (isShortStandalone || isOptionMarked) {
          shortRun++;
          j++;
        } else {
          break;
        }
      }

      if (shortRun >= 2) {
        // Whole stem + options block is a leaked question. Drop it all.
        i = j;
        continue;
      }
    }

    out.push(line);
    i++;
  }

  return out.join("\n");
}

/**
 * Structural score-based sanitizer that drops leaked reasoning paragraphs,
 * meta-narration tool announcements, and plain-text MCQ option lists from student-facing chat text.
 */
export function sanitizeChatText(raw?: string): string {
  if (!raw) return "";

  // Strip <think> blocks first (closed or cut off mid-stream)
  let text = cleanThoughtText(raw);
  if (!text) return "";

  // Drop leaked question/option blocks structurally
  text = stripQuestionBlocks(text);

  // Score and drop leaked-reasoning paragraphs wholesale
  const paragraphs = text.split(/\n\s*\n/);
  const kept = paragraphs.filter((p) => leakScore(p) < LEAK_THRESHOLD);
  text = kept.join("\n\n").trim();

  // Dedupe consecutive identical sentences
  const sentences = text.split(/(?<=[.!?])\s+/);
  const deduped: string[] = [];
  for (const s of sentences) {
    const sTrim = s.trim();
    if (!sTrim) continue;
    if (
      deduped.length > 0 &&
      deduped[deduped.length - 1].toLowerCase() === sTrim.toLowerCase()
    ) {
      continue;
    }
    deduped.push(sTrim);
  }

  return deduped.join(" ").trim();
}

/**
 * Builds a composite system prompt string from persona, context, and instruction options.
 */
export function buildSystemPrompt(options: {
  personaPrompt?: string;
  context?: string;
  instructions?: string;
  mode?: string;
  topic?: string;
  difficulty?: string;
} = {}): string {
  const parts: string[] = [];
  if (options.personaPrompt) parts.push(options.personaPrompt);
  if (options.context) parts.push(`Context:\n${options.context}`);
  if (options.instructions) parts.push(`Instructions:\n${options.instructions}`);
  return parts.join("\n\n");
}
