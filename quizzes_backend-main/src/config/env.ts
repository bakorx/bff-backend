import {config} from "dotenv"
config();

function requireEnv(...keys: string[]): string {
    for (const key of keys) {
        const value = process.env[key];
        
        if (value){
            return value
        }
    }

    throw new Error(
        `Missing required environment variable. Expected one of: ${keys.join(", ")}`
    )
}

export const ENV = {
  PORT: process.env.PORT || "5000",
  MONGO_URI: requireEnv("MONGO_URI"),
  NODE_ENV: process.env.NODE_ENV || "development",
  ACCESS_TOKEN_SECRET: requireEnv("ACCESS_TOKEN_SECRET"),
  REFRESH_TOKEN_SECRET: requireEnv("REFRESH_TOKEN_SECRET"),
  SALT_ROUNDS: parseInt(requireEnv("SALT_ROUNDS")),
  LOGS: {
    LOG_LEVEL: process.env.LOG_LEVEL || "info",
    LOG_FILENAME: process.env.LOG_FILENAME || "logs/qz-%DATE%.log",
  },
  SOCKET_PATH: process.env.SOCKET_PATH || "/socket.io",
  PAYSTACK_SECRET_KEY_TEST: requireEnv("PAYSTACK_SECRET_KEY_TEST"),
  PAYSTACK_SECRET_KEY_LIVE: requireEnv("PAYSTACK_SECRET_KEY_LIVE"),
  GOOGLE: {
    GENAI_API_KEY: requireEnv(
      "GOOGLE_GENAI_API_KEY",
      "GENAI_API_KEY",
      "GEMINI_API_KEY",
    ),
    DEFAULT_MODEL: process.env.GEMINI_DEFAULT_MODEL || "googleai/gemini-2.0-flash",
    CLIENT_ID: requireEnv("GOOGLE_CLIENT_ID"),
  },
  GITHUB: {
    CLIENT_ID: process.env.GITHUB_CLIENT_ID,
    CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
  },
  SMTP: {
    HOST: requireEnv("SMTP_HOST"),
    PORT: Number(process.env.SMTP_PORT || 587),
    USER: requireEnv("SMTP_USER"),
    PASS: requireEnv("SMTP_PASS"),
    FROM_NAME: process.env.SMTP_FROM_NAME || "Qz",
    FROM_EMAIL: requireEnv("SMTP_FROM_EMAIL"),
  },

  VAPID: {
    SUBJECT: process.env.VAPID_SUBJECT || "mailto:admin@bflabs.tech",
    PUBLIC_KEY: requireEnv("VAPID_PUBLIC_KEY"),
    PRIVATE_KEY: requireEnv("VAPID_PRIVATE_KEY"),
  },

  FRONTEND_URL: requireEnv("FRONTEND_URL"),
  REDIS_URL: requireEnv("REDISCLOUD_URL", "REDIS_URL"),
  BULL_BOARD: {
    USERNAME: requireEnv("BULL_BOARD_USERNAME"),
    PASSWORD: requireEnv("BULL_BOARD_PASSWORD"),
  },

  AI_PROVIDER: process.env.AI_PROVIDER || "openrouter",
  AI_TIER_OVERRIDE: (process.env.AI_TIER_OVERRIDE || "auto") as "auto" | "free" | "paid",
  AI_ALLOW_FREE_USER_PAID_MODELS: process.env.AI_ALLOW_FREE_USER_PAID_MODELS === "false",
  AI: {
    DEFAULT_MODEL:
      process.env.AI_DEFAULT_MODEL ||
      (process.env.AI_PROVIDER === "groq"
        ? process.env.GROQ_DEFAULT_MODEL || "groq/openai/gpt-oss-20b"
        : process.env.AI_PROVIDER === "openrouter"
        ? process.env.OPENROUTER_DEFAULT_MODEL || "openai/openrouter/free"
        : process.env.GEMINI_DEFAULT_MODEL || "googleai/gemini-3.5-flash-lite"),
    PAID_DEFAULT_MODEL:
      process.env.PAID_AI_MODEL || "openai/gpt-4o-mini",
    PAID_FALLBACK_MODEL:
      process.env.PAID_AI_FALLBACK_MODEL || "openai/gpt-4o",
    MAX_OUTPUT_TOKENS: parseInt(process.env.AI_MAX_OUTPUT_TOKENS || "2048", 10),
    TEMPERATURE: parseFloat(process.env.AI_TEMPERATURE || "0.7"),
    SAFETY_THRESHOLD:
      process.env.AI_SAFETY_THRESHOLD || "BLOCK_MEDIUM_AND_ABOVE",
    CREDITS_PER_MESSAGE: parseInt(
      process.env.AI_CREDITS_PER_MESSAGE || "1",
      10,
    ),
    LOW_CREDIT_THRESHOLD: parseInt(
      process.env.AI_LOW_CREDIT_THRESHOLD || "5",
      10,
    ),
  },

  GROQ: {
    API_KEY:
      process.env.AI_PROVIDER === "groq"
        ? requireEnv("GROQ_API_KEY", "GROQ_KEY")
        : process.env.GROQ_API_KEY || "",
    DEFAULT_MODEL:
      process.env.GROQ_DEFAULT_MODEL || "groq/qwen/qwen3.6-27b",
    FALLBACK_MODEL:
      process.env.GROQ_FALLBACK_MODEL || "groq/qwen/qwen3.8-27b",
    FALLBACK_MODEL_2:
      process.env.GROQ_FALLBACK_MODEL_2 || "groq/openai/gpt-oss-20b",
  },

  OPENROUTER: {
    API_KEY:
      process.env.AI_PROVIDER === "openrouter"
        ? requireEnv("OPENROUTER_API_KEY")
        : process.env.OPENROUTER_API_KEY || "",
    BASE_URL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    DEFAULT_MODEL:
      process.env.OPENROUTER_DEFAULT_MODEL ||
      "openai/openrouter/free",
    FALLBACK_MODEL:
      process.env.OPENROUTER_FALLBACK_MODEL ||
      "openai/google/gemini-2.0-flash:free",
    FALLBACK_MODEL_2:
      process.env.OPENROUTER_FALLBACK_MODEL_2 ||
      "openai/meta-llama/llama-3.3-70b-instruct:free",
    SITE_URL: process.env.OPENROUTER_SITE_URL || "https://q.prestoghana.com",
    SITE_NAME: process.env.OPENROUTER_SITE_NAME || "Presto Q",
  },
  CLOUDINARY: {
    CLOUD_NAME: requireEnv("CLOUDINARY_CLOUD_NAME"),
    API_KEY: requireEnv("CLOUDINARY_API_KEY"),
    API_SECRET: requireEnv("CLOUDINARY_API_SECRET"),
  },

  // Qubi mascot assets served from Cloudinary. Empty string disables the mascot.
  EMAIL_QUBI_PEEK_URL: process.env.EMAIL_QUBI_PEEK_URL || "",
  EMAIL_QUBI_STUDY_URL: process.env.EMAIL_QUBI_STUDY_URL || "",
  EMAIL_QUBI_WAVE_URL: process.env.EMAIL_QUBI_WAVE_URL || "",
};