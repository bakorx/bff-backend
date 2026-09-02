import { ai, Z_MODEL} from "@/ai";
import { estimateTokens } from "@/learning/utils";
import { LLMUsage } from "./models";

// ---------------------------------------------------------------------------
// LLM client wrapper — rec-engine.md §15 "LLM client wrapper".
//
// "All LLM calls related to recommendations route through a single
// LLMClient wrapper... Is the only path for rec-related LLM calls (no
// direct genkit/openai calls in rec services)." This is that wrapper.
// Two callers: memory-pipeline.ts's LLM fact extraction (purpose:
// "memory_extraction") and services.ts#generatePremiumRecs's synthesis
// call (purpose: "rec_synthesis") — see ILLMUsage's doc comment for why
// they're tracked as separate budgets.
// ---------------------------------------------------------------------------

// Approximate cost per 1K tokens (input, output), USD — public list-price
// estimates for cost *budgeting* per §15's cost tables, not exact billing
// reconciliation. The active model is env-configurable (see
// @/ai/config#Z_MODEL, which can resolve to either an OpenRouter or a
// Google Gemini model depending on ENV.AI_PROVIDER), so this is necessarily
// approximate — there's no live provider billing API wired up.
const COST_PER_1K_TOKENS: Record<string, { input: number; output: number }> = {
  "openai/gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "openai/gpt-4o": { input: 0.0025, output: 0.01 },
  // Gemini flash-tier models — small-model pricing, same ballpark as 4o-mini.
  default: { input: 0.0002, output: 0.0008 },
};

function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rates = COST_PER_1K_TOKENS[model] ?? COST_PER_1K_TOKENS.default;
  return (
    (inputTokens / 1000) * rates.input + (outputTokens / 1000) * rates.output
  );
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC
}

export interface LLMGenerateOptions {
  userId: string;
  /** Which daily budget pool this call draws from — see ILLMUsage's doc comment. */
  purpose: "memory_extraction" | "rec_synthesis";
  /** Caller resolves this from the relevant tier table (§7, §15). */
  dailyBudget: number;
  prompt: string;
  system?: string;
  /** Zod schema, passed through to genkit's output.schema for structured output. */
  outputSchema?: unknown;
}

export interface LLMGenerateResult<T = unknown> {
  /** true if the user's daily LLM call budget was already exhausted — no call was made. */
  budgetExceeded: boolean;
  response?: T;
  costUsd: number;
  latencyMs: number;
}

export const LLMClient = {
  /**
   * Enforces the per-user daily call cap (§15) atomically before spending
   * anything, then makes the call and returns cost/latency alongside the
   * response — matching §15's `{ response, costUsd, latencyMs }` contract.
   */
  async generate<T = unknown>(
    opts: LLMGenerateOptions,
  ): Promise<LLMGenerateResult<T>> {
    const date = todayKey();

    const usageDoc = await LLMUsage.findOneAndUpdate(
      { userId: opts.userId, date, purpose: opts.purpose },
      { $setOnInsert: { userId: opts.userId, date, purpose: opts.purpose, callCount: 0 } },
      { upsert: true, new: true },
    );

    if (usageDoc.callCount >= opts.dailyBudget) {
      return { budgetExceeded: true, costUsd: 0, latencyMs: 0 };
    }

    const claim = await LLMUsage.updateOne(
      { _id: usageDoc._id, callCount: { $lt: opts.dailyBudget } },
      { $inc: { callCount: 1 } },
    );
    if (claim.modifiedCount === 0) {
      // Budget was claimed by a concurrent call between the read above and
      // this write. Rare for a per-user batch cron, but handled correctly.
      return { budgetExceeded: true, costUsd: 0, latencyMs: 0 };
    }

    const start = Date.now();
    const genOpts: Record<string, unknown> = {
      model: Z_MODEL,
      prompt: opts.prompt,
    };
    if (opts.system) genOpts.system = opts.system;
    if (opts.outputSchema) genOpts.output = { schema: opts.outputSchema };

    const result: any = await ai.generate(genOpts);
    const latencyMs = Date.now() - start;

    const inputTokens =
      result?.usage?.inputTokens ??
      estimateTokens(opts.prompt + (opts.system ?? ""));
    const outputTokens =
      result?.usage?.outputTokens ??
      estimateTokens(JSON.stringify(result?.output ?? result?.text ?? ""));
    const costUsd = estimateCostUsd(String(Z_MODEL), inputTokens, outputTokens);

    return {
      budgetExceeded: false,
      response: (result?.output ?? result?.text) as T,
      costUsd,
      latencyMs,
    };
  },
};
