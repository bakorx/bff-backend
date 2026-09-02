import { Schema, model, Model } from "mongoose";
import { IEvent } from "./interfaces";

export const MAX_SUPPORTED_EVENT_VERSION = 1;

const SourceRefSchema = new Schema(
  {
    type: { type: String, required: true },
    id: { type: Schema.Types.ObjectId, required: true },
  },
  { _id: false },
);

// ---------------------------------------------------------------------------
// Event — the primary product telemetry layer. docs/rec-engine.md §6.
//
// Retention: issue #179 originally specified a 48h TTL on this collection.
// That's deliberately not implemented here — rec-engine.md §7's weekly
// rollup reads a 7-day window and locked_in tier reads up to the last 100
// events, both of which a 48h purge would silently break. EventStore is
// long-lived per §6 ("primary product telemetry layer, not a sidecar").
// Revisit only as a storage-cost decision, not a correctness one.
// ---------------------------------------------------------------------------

const EventSchema = new Schema<IEvent>(
  {
    eventVersion: {
      type: Number,
      required: true,
      default: MAX_SUPPORTED_EVENT_VERSION,
    },
    eventType: { type: String, required: true, trim: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    sourceRef: { type: SourceRefSchema, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    occurredAt: { type: Date, required: true },
    receivedAt: { type: Date, required: true, default: () => new Date() },
    privacy: { type: String, enum: ["public", "private"], required: true },
    tier: {
      type: String,
      enum: ["free", "cooked", "cruising", "locked_in"],
      required: true,
    },
    // Minute-bucketed occurredAt (epoch minutes). Backs the dedup unique
    // index below (rec-engine.md §6 "Dedup"). Recomputed at write time in
    // services.ts#emit — not meant to be read directly by consumers.
    occurredAtBucket: { type: Number, required: true },
  },
  { timestamps: { createdAt: false, updatedAt: false } },
);

// Dedup: userId + sourceRef.type + sourceRef.id + eventType + 1-min bucket
// of occurredAt. A second write for the same key is caught as a duplicate
// key error and resolved to the existing record — see services.ts#emit.
EventSchema.index(
  {
    userId: 1,
    "sourceRef.type": 1,
    "sourceRef.id": 1,
    eventType: 1,
    occurredAtBucket: 1,
  },
  { unique: true },
);

// Time-window reads for a user — rec-engine.md §7 memory pipeline (24h/7d windows).
EventSchema.index({ userId: 1, occurredAt: -1 });
// Same, filtered to specific event types (readEvents({ eventTypes })).
EventSchema.index({ userId: 1, eventType: 1, occurredAt: -1 });
// Cursor pagination for GET /api/v1/events (issue #180) — receivedAt is the
// createdAt equivalent here, since occurredAt is client/event time and can
// arrive out of order on retries.
EventSchema.index({ userId: 1, receivedAt: -1, _id: -1 });

export const Event: Model<IEvent> = model<IEvent>("Event", EventSchema);
