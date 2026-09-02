import { genkit, z } from "genkit";
import { openAI, gpt4oMini } from "genkitx-openai";
import { googleAI } from "@genkit-ai/google-genai";
import {
  groq,
  llama33x70bVersatile,
  llama31x8bInstant,
  deepseekR1DistillLlamax70b,
  gemma2x9b,
  llama3x70b,
  llama3x8b,
} from "genkitx-groq";
import { ENV } from "@/config/env";
import {
  GOOGLE_CONFIG,
  GROQ_CONFIG,
  OPENROUTER_CONFIG,
  OPENROUTER_PAID_MODELS,
  OPENROUTER_FREE_MODELS,
  Z_MODEL,
} from "./constants";
import { generateWithRetryFallback } from "./utils";

// Dynamically collect any model referenced in ENV
const envOpenRouterModels = [
  ENV.AI.DEFAULT_MODEL,
  ENV.AI.PAID_DEFAULT_MODEL,
  ENV.AI.PAID_FALLBACK_MODEL,
  ENV.OPENROUTER.DEFAULT_MODEL,
  ENV.OPENROUTER.FALLBACK_MODEL,
  ENV.OPENROUTER.FALLBACK_MODEL_2,
]
  .filter(Boolean)
  .map((m) => (m.startsWith("openai/") ? m.replace(/^openai\//, "") : m));

const allOpenRouterModelNames = Array.from(
  new Set([
    ...OPENROUTER_PAID_MODELS,
    ...OPENROUTER_FREE_MODELS,
    ...envOpenRouterModels,
  ]),
);

const OpenAiConfigSchema = z
  .object({
    temperature: z.number().optional(),
    maxOutputTokens: z.number().optional(),
    topP: z.number().optional(),
    stopSequences: z.array(z.string()).optional(),
  })
  .passthrough();

const openRouterModelDefs = allOpenRouterModelNames.map((name) => ({
  name,
  info: {
    label: name,
    supports: {
      multiturn: true,
      tools: true,
      media: true,
      systemRole: true,
      output: ["text", "json"],
    },
  },
  configSchema: OpenAiConfigSchema,
}));

const plugins: any[] = [];

if (GOOGLE_CONFIG.API_KEY) {
  plugins.push(googleAI({ apiKey: GOOGLE_CONFIG.API_KEY }));
}

if (GROQ_CONFIG.API_KEY) {
  plugins.push(groq({ apiKey: GROQ_CONFIG.API_KEY }));
}

if (OPENROUTER_CONFIG.API_KEY) {
  plugins.push(
    openAI({
      baseURL: OPENROUTER_CONFIG.BASE_URL,
      apiKey: OPENROUTER_CONFIG.API_KEY,
      models: openRouterModelDefs,
    }),
  );
}

const baseAi = genkit({
  plugins,
  model: Z_MODEL,
});

const originalGenerate = baseAi.generate.bind(baseAi);

export interface ExtendedGenerateOptions {
  model?: string;
  userId?: string;
  isSubscribed?: boolean;
  system?: string;
  prompt?: string;
  messages?: any[];
  tools?: any[];
  output?: any;
  config?: any;
  maxTurns?: number;
  onChunk?: (chunk: any) => void;
  context?: any;
  docs?: any[];
  [key: string]: any;
}

const customGenerate = async function generate(
  options: ExtendedGenerateOptions | string,
): Promise<any> {
  if (typeof options === "string") {
    return generateWithRetryFallback(originalGenerate, { prompt: options });
  }
  return generateWithRetryFallback(originalGenerate, options);
};

export const ai = new Proxy(baseAi, {
  get(target, prop, receiver) {
    if (prop === "generate") {
      return customGenerate;
    }
    return Reflect.get(target, prop, receiver);
  },
}) as Omit<typeof baseAi, "generate"> & {
  generate: (options: ExtendedGenerateOptions | string) => Promise<any>;
};

export {
  gpt4oMini,
  llama33x70bVersatile,
  llama31x8bInstant,
  deepseekR1DistillLlamax70b,
  gemma2x9b,
  llama3x70b,
  llama3x8b,
};

export * from "./constants";
export * from "./utils";
export * from "./interfaces";
