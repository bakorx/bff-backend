import { ENV } from "@/config/env";
import {
  OpenRouterFreeModel,
  OpenRouterPaidModel,
  GoogleFreeModel,
  GooglePaidModel,
  GroqFreeModel,
  GroqPaidModel,
  AIModel,
} from "./interfaces";
import { normalizeModelName } from "./utils";

export const GOOGLE_CONFIG = {
  API_KEY: ENV.GOOGLE.GENAI_API_KEY,
  DEFAULT_MODEL: ENV.GOOGLE.DEFAULT_MODEL || "googleai/gemini-3.5-flash-lite",
  FALLBACK_MODEL: "googleai/gemini-3-flash-preview",
  FALLBACK_MODEL_2: "googleai/gemini-3.1-flash-lite",
};

export const GROQ_CONFIG = {
  API_KEY: ENV.GROQ.API_KEY,
  DEFAULT_MODEL: ENV.GROQ.DEFAULT_MODEL || "groq/openai/gpt-oss-20b",
  FALLBACK_MODEL: ENV.GROQ.FALLBACK_MODEL || "groq/openai/gpt-oss-120b",
  FALLBACK_MODEL_2: ENV.GROQ.FALLBACK_MODEL_2 || "groq/qwen/qwen3.8-27b",
};

export const OPENROUTER_CONFIG = {
  API_KEY: ENV.OPENROUTER.API_KEY,
  BASE_URL: ENV.OPENROUTER.BASE_URL,
  DEFAULT_MODEL: ENV.OPENROUTER.DEFAULT_MODEL || "openai/openrouter/free",
  FALLBACK_MODEL: ENV.OPENROUTER.FALLBACK_MODEL || "openai/openrouter/auto",
  FALLBACK_MODEL_2: ENV.OPENROUTER.FALLBACK_MODEL_2,
};

export const OPENROUTER_FREE_MODELS: OpenRouterFreeModel[] = [
  "openai/openrouter/free",
  "openai/openrouter/auto",
  "openai/cohere/north-mini-code:free",
  "openai/nvidia/nemotron-3-super-120b-a12b:free",
  "openai/minimax/minimax-m3:free",
];

export const OPENROUTER_PAID_MODELS: OpenRouterPaidModel[] = [
  "openai/gpt-4o-mini",
  "openai/gpt-4o",
  "openai/openai/gpt-4o-mini",
  "openai/openai/gpt-4o",
];

export const GOOGLE_FREE_MODELS: GoogleFreeModel[] = [
  "googleai/gemini-3.5-flash-lite",
  "googleai/gemini-3-flash-preview",
  "googleai/gemini-3.1-flash-lite",
];

export const GOOGLE_PAID_MODELS: GooglePaidModel[] = [
  "googleai/gemini-3.6-flash",
];

export const GROQ_FREE_MODELS: GroqFreeModel[] = [
  "groq/openai/gpt-oss-20b",
  "groq/qwen/qwen3.8-27b",
];

export const GROQ_PAID_MODELS: GroqPaidModel[] = [
  "groq/openai/gpt-oss-120b",
];

export const HAS_GOOGLE_KEY = Boolean(GOOGLE_CONFIG.API_KEY);
export const HAS_GROQ_KEY = Boolean(GROQ_CONFIG.API_KEY);
export const HAS_OPENROUTER_KEY = Boolean(OPENROUTER_CONFIG.API_KEY);

export const IS_OPENROUTER_PREFERRED =
  ENV.AI_PROVIDER === "openrouter" && HAS_OPENROUTER_KEY;
export const IS_GROQ_PREFERRED =
  ENV.AI_PROVIDER === "groq" && HAS_GROQ_KEY;
export const IS_GOOGLE_PREFERRED =
  ENV.AI_PROVIDER === "google" && HAS_GOOGLE_KEY;

export const RAW_DEFAULT_MODEL = IS_OPENROUTER_PREFERRED
  ? (ENV.AI.DEFAULT_MODEL || OPENROUTER_CONFIG.DEFAULT_MODEL || "openai/openrouter/free")
  : IS_GROQ_PREFERRED
  ? (ENV.AI.DEFAULT_MODEL || GROQ_CONFIG.DEFAULT_MODEL || "groq/openai/gpt-oss-20b")
  : IS_GOOGLE_PREFERRED
  ? (ENV.AI.DEFAULT_MODEL || GOOGLE_CONFIG.DEFAULT_MODEL || "googleai/gemini-3.5-flash-lite")
  : (ENV.AI.DEFAULT_MODEL || OPENROUTER_CONFIG.DEFAULT_MODEL || GROQ_CONFIG.DEFAULT_MODEL || GOOGLE_CONFIG.DEFAULT_MODEL);

export const RAW_FALLBACK_MODEL = IS_OPENROUTER_PREFERRED
  ? (OPENROUTER_CONFIG.FALLBACK_MODEL || "openai/openrouter/auto")
  : IS_GROQ_PREFERRED
  ? (GROQ_CONFIG.FALLBACK_MODEL || "groq/openai/gpt-oss-120b")
  : (GOOGLE_CONFIG.FALLBACK_MODEL || "googleai/gemini-3-flash-preview");

export const Z_MODEL = normalizeModelName(RAW_DEFAULT_MODEL);
export const Z_FALLBACK_MODEL = normalizeModelName(RAW_FALLBACK_MODEL);

export const AI_CONFIG = {
  DEFAULT_MODEL: (ENV.AI.DEFAULT_MODEL ? normalizeModelName(ENV.AI.DEFAULT_MODEL) : Z_MODEL) as AIModel,
  API_KEY: IS_OPENROUTER_PREFERRED
    ? OPENROUTER_CONFIG.API_KEY
    : IS_GROQ_PREFERRED
    ? GROQ_CONFIG.API_KEY
    : IS_GOOGLE_PREFERRED
    ? GOOGLE_CONFIG.API_KEY
    : OPENROUTER_CONFIG.API_KEY || GROQ_CONFIG.API_KEY || GOOGLE_CONFIG.API_KEY,
  MAX_OUTPUT_TOKENS: ENV.AI.MAX_OUTPUT_TOKENS,
  TEMPERATURE: ENV.AI.TEMPERATURE,
  SAFETY_THRESHOLD: ENV.AI.SAFETY_THRESHOLD,
  CREDITS_PER_MESSAGE: ENV.AI.CREDITS_PER_MESSAGE,
  LOW_CREDIT_THRESHOLD: ENV.AI.LOW_CREDIT_THRESHOLD,
} as const;
