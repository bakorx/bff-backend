import type { ComponentId } from "./interfaces";

/**
 * Static metadata for each monitored component. Lives outside services.ts so
 * both the probe aggregator (services.ts) and the reports serializer
 * (reports/serializers.ts) can reuse it.
 */
export const COMPONENT_META: Record<ComponentId, { label: string }> = {
  mongodb: { label: "Database" },
  redis: { label: "Cache & Queue" },
  openrouter: { label: "AI Inference" },
  api: { label: "Public API" },
};