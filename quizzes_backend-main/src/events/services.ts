import { Types } from "mongoose";
import { logger } from "@/config";
import { publishers } from "@/socket";
import { Subscription, Package } from "@/subscriptions";
import { Event, MAX_SUPPORTED_EVENT_VERSION } from "./models";
import { isAllowedEventType, resolveDefaultPrivacy } from "./taxonomy";
import {
  IEvent,
  EmitSourceRef,
  EmitOptions,
  ReadEventsQuery,
  EventCursorPage,
  EventTier,
} from "./interfaces";

const MINUTE_MS = 60_000;

function bucketOf(occurredAt: Date): number {
  return Math.floor(occurredAt.getTime() / MINUTE_MS);
}

/**
 * Write path for the event bus (rec-engine.md §6). Fire-and-forget by
 * contract: never throws. On failure the event is dropped and logged — see
 * §6 "Backpressure". Do NOT await this in a way that blocks a user-facing
 * response; call it in the controller's tail, after sendSuccess.
 *
 * The controller boundary decides what crosses into the bus (§6): eventType
 * must be in the §6a taxonomy allow-list, or the event is dropped here
 * before it's written. privacy and tier are resolved internally — not
 * caller-supplied — so callers (future #25 controller hooks) just pass the
 * event and don't need to know the taxonomy or re-derive the user's plan.
 *
 * sourceRef.id and userId may be raw strings — cast to ObjectId happens
 * below, inside the try/catch, so a malformed id can never throw out of
 * this function. emit() must be safe to call fire-and-forget from a
 * controller's tail without risking the response that already went out.
 */
export async function emit(
  eventType: string,
  userId: Types.ObjectId | string,
  sourceRef: EmitSourceRef,
  payload: Record<string, unknown>,
  opts: EmitOptions = {},
): Promise<IEvent | undefined> {
  const defaultPrivacy = resolveDefaultPrivacy(eventType);
  if (!isAllowedEventType(eventType) || !defaultPrivacy) {
    logger.warn(
      `[events] "${eventType}" is not in the §6a taxonomy allow-list — dropping`,
    );
    return undefined;
  }

  const occurredAt = opts.occurredAt ?? new Date();
  const occurredAtBucket = bucketOf(occurredAt);

  try {
    const sourceRefId = new Types.ObjectId(sourceRef.id);
    const tier = await resolveUserTier(userId);
    const doc = await Event.create({
      eventVersion: MAX_SUPPORTED_EVENT_VERSION,
      eventType,
      userId,
      sourceRef: { type: sourceRef.type, id: sourceRefId },
      payload,
      occurredAt,
      receivedAt: new Date(),
      privacy: defaultPrivacy,
      tier,
      occurredAtBucket,
    });

    publishers.eventCreated({
      eventId: String(doc._id),
      eventType: doc.eventType,
      userId: String(doc.userId),
    });

    return doc;
  } catch (error: any) {
    if (error?.code === 11000) {
      // Duplicate within the same 1-min dedup bucket — expected on client
      // retries, not a real failure. Second write returns the existing
      // record (rec-engine.md §6 "Dedup").
      const existing = await Event.findOne({
        userId,
        "sourceRef.type": sourceRef.type,
        "sourceRef.id": sourceRef.id,
        eventType,
        occurredAtBucket,
      });
      if (existing) return existing;
      logger.warn(
        `[events] dedup collision on "${eventType}" but existing record not found — dropping`,
      );
      return undefined;
    }

    logger.error(
      `[events] emit failed for "${eventType}": ${error?.message ?? error}`,
    );
    return undefined;
  }
}

/**
 * Internal read path for the memory pipeline (§7) and ad-hoc analytics.
 * Not paginated — callers own the window (`since`) and are expected to keep
 * it bounded (the pipeline reads 24h/7d windows, never "all time").
 */
export async function readEvents(query: ReadEventsQuery): Promise<IEvent[]> {
  const filter: Record<string, unknown> = {
    userId: query.userId,
    eventVersion: { $lte: MAX_SUPPORTED_EVENT_VERSION },
  };
  if (query.since) {
    filter.occurredAt = { $gte: query.since };
  }
  if (query.eventTypes?.length) {
    filter.eventType = { $in: query.eventTypes };
  }

  return Event.find(filter)
    .sort({ occurredAt: -1 })
    .limit(query.limit ?? 1000);
}

/**
 * HTTP-facing read path (issue #180). Cursor-based, NOT offset-based — the
 * cursor is (receivedAt, _id) so pagination stays stable even as new events
 * land mid-scroll. receivedAt (server write time) stands in for createdAt,
 * since occurredAt is client/event time and can arrive out of order on
 * retries.
 */
export async function listEventsForUser(
  userId: Types.ObjectId | string,
  opts: { cursor?: string; limit?: number; eventTypes?: string[] } = {},
): Promise<EventCursorPage> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const filter: Record<string, unknown> = {
    userId,
    eventVersion: { $lte: MAX_SUPPORTED_EVENT_VERSION },
  };
  if (opts.eventTypes?.length) {
    filter.eventType = { $in: opts.eventTypes };
  }

  const decoded = opts.cursor ? decodeCursor(opts.cursor) : null;
  if (decoded) {
    filter.$or = [
      { receivedAt: { $lt: decoded.receivedAt } },
      { receivedAt: decoded.receivedAt, _id: { $lt: decoded.id } },
    ];
  }

  const events = await Event.find(filter)
    .sort({ receivedAt: -1, _id: -1 })
    .limit(limit + 1);

  const hasMore = events.length > limit;
  const page = hasMore ? events.slice(0, limit) : events;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor(last.receivedAt, String(last._id)) : null;

  return { events: page, nextCursor };
}

function encodeCursor(receivedAt: Date, id: string): string {
  return Buffer.from(
    JSON.stringify({ receivedAt: receivedAt.toISOString(), id }),
  ).toString("base64url");
}

function decodeCursor(cursor: string): { receivedAt: Date; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!parsed?.receivedAt || !parsed?.id) return null;
    return { receivedAt: new Date(parsed.receivedAt), id: parsed.id };
  } catch {
    return null;
  }
}

/**
 * Resolves a user's current effective tier via a direct Subscription/
 * Package lookup. Called internally by emit() for every write (rec-engine.md
 * §3 "Tier resolution") — not cached yet. Fine at today's call volume (one
 * user-initiated POST /api/v1/events per call); revisit if #25 wires this
 * into a high-frequency event like quiz:question_answered.
 */
export async function resolveUserTier(
  userId: Types.ObjectId | string,
): Promise<EventTier> {
  const activeSub = await Subscription.findOne({
    userId,
    status: "active",
  }).populate("packageId");

  const pkg = activeSub?.packageId as unknown as
    | (InstanceType<typeof Package> & { tier?: string })
    | undefined;

  if (
    pkg?.tier === "cooked" ||
    pkg?.tier === "cruising" ||
    pkg?.tier === "locked_in"
  ) {
    return pkg.tier;
  }
  return "free";
}
