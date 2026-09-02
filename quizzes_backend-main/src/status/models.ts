import mongoose, { Schema, model, Types } from "mongoose";
import type { Document } from "mongoose";
import type { ComponentId, ComponentState } from "./interfaces";

/**
 * One row per probe run. TTL-indexed at 24h so the collection self-prunes.
 * Aggregated on demand by services.ts into hourly buckets for the
 * /api/v1/status/history endpoint.
 */
export interface IStatusProbe extends Document {
  componentId: ComponentId;
  state: ComponentState;
  latencyMs: number | null;
  message?: string;
  checkedAt: Date;
  // Mongo adds _id implicitly; kept off the public interface.
  _id: Types.ObjectId;
}

const StatusProbeSchema = new Schema<IStatusProbe>(
  {
    componentId: {
      type: String,
      enum: ["mongodb", "redis", "openrouter", "api"],
      required: true,
      index: true,
    },
    state: {
      type: String,
      enum: ["operational", "degraded", "down"],
      required: true,
    },
    latencyMs: { type: Number, default: null },
    message: { type: String, default: undefined },
    checkedAt: { type: Date, required: true},
  },
  { versionKey: false },
);

// TTL index — Mongo will auto-delete rows older than 24h.
StatusProbeSchema.index(
  { checkedAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 },
);

// Compound index for the hourly aggregation in services.ts.
StatusProbeSchema.index({ componentId: 1, checkedAt: 1 });

export const StatusProbeModel = model<IStatusProbe>(
  "StatusProbe",
  StatusProbeSchema,
);