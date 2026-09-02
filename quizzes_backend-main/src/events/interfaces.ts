import { Document, Types } from "mongoose";

// ---------------------------------------------------------------------------
// Event bus — see docs/rec-engine.md §6, §6a. Issues #179, #180.
// ---------------------------------------------------------------------------

export type EventPrivacy = "public" | "private";
export type EventTier = "free" | "cooked" | "cruising" | "locked_in";

/** Pointer back to the source document that caused this event. */
export interface ISourceRef {
  type: string;
  id: Types.ObjectId;
}

/**
 * What emit() callers actually pass — id as a string is fine, cast happens
 * inside emit()'s own try/catch so a malformed id can never throw into a
 * controller's response flow (emit() is fire-and-forget by contract).
 */
export interface EmitSourceRef {
  type: string;
  id: Types.ObjectId | string;
}

export interface IEvent extends Document {
  _id: Types.ObjectId;
  /** Bumped on field additions/renames. Readers filter eventVersion <= MAX_SUPPORTED_EVENT_VERSION. */
  eventVersion: number;
  /** e.g. "session:finished" — must be one of the §6a taxonomy types once #24/#25 land. */
  eventType: string;
  userId: Types.ObjectId;
  sourceRef: ISourceRef;
  payload: Record<string, unknown>;
  /** Client/event time — when the thing actually happened. */
  occurredAt: Date;
  /** Server receipt time — may lag occurredAt on retries. Used as the pagination cursor field. */
  receivedAt: Date;
  privacy: EventPrivacy;
  tier: EventTier;
  /** Minute-bucketed occurredAt. Backs the dedup unique index — not a public field. */
  occurredAtBucket: number;
}

export interface EmitOptions {
  /** Defaults to now. Pass explicitly for backdated/replayed events. */
  occurredAt?: Date;
}

/** Internal read path — rec-engine.md §7 memory pipeline + ad-hoc analytics. */
export interface ReadEventsQuery {
  userId: Types.ObjectId | string;
  since?: Date;
  eventTypes?: string[];
  limit?: number;
}

export interface EventCursorPage {
  events: IEvent[];
  nextCursor: string | null;
}
