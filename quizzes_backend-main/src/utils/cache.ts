import { Types } from "mongoose";
import { logger, redisConnection } from "@/config";

const DEFAULT_TTL_SECONDS = 3600; // 1 hour

/**
 * Generic helper to construct standard colon-delimited Redis cache keys.
 */
export function buildCacheKey(
  prefix: string,
  ...parts: Array<string | number | Types.ObjectId | undefined | null>
): string {
  const cleanParts = parts
    .filter((p) => p !== undefined && p !== null && String(p).trim() !== "")
    .map((p) => String(p).trim());
  return [prefix, ...cleanParts].join(":");
}

// ─── String Key-Value Operations ────────────────────────────────────────────

/**
 * Reads and parses JSON from Redis cache.
 * Returns null if key is not found, Redis is offline, or JSON is invalid.
 */
export async function getCache<T>(key: string): Promise<T | null> {
  try {
    const raw = await redisConnection.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (error) {
    logger.warn(
      `[Cache] Failed to get key "${key}":`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Serializes and saves data to Redis with a TTL in seconds.
 */
export async function setCache<T>(
  key: string,
  data: T,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<void> {
  try {
    await redisConnection.set(
      key,
      JSON.stringify(data),
      "EX",
      ttlSeconds,
    );
  } catch (error) {
    logger.warn(
      `[Cache] Failed to set key "${key}":`,
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Deletes one or more cache keys, or invalidates a pattern if it contains `*`.
 */
export async function invalidateCache(keyOrPattern: string): Promise<void> {
  try {
    if (!keyOrPattern) return;
    if (keyOrPattern.includes("*")) {
      const keys = await redisConnection.keys(keyOrPattern);
      if (keys.length > 0) {
        await redisConnection.del(...keys);
      }
    } else {
      await redisConnection.del(keyOrPattern);
    }
  } catch (error) {
    logger.warn(
      `[Cache] Failed to invalidate "${keyOrPattern}":`,
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * High-level Cache-Aside wrapper: gets from cache or fetches from factory, caches, and returns.
 */
export async function getOrSetCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<{ data: T; fromCache: boolean }> {
  const cached = await getCache<T>(key);
  if (cached !== null) {
    return { data: cached, fromCache: true };
  }

  const fresh = await fetcher();
  await setCache(key, fresh, ttlSeconds);
  return { data: fresh, fromCache: false };
}

// ─── Set Operations ─────────────────────────────────────────────────────────

/**
 * Adds one or more members to a Redis set.
 */
export async function addToSet(
  key: string,
  ...members: Array<string | number>
): Promise<void> {
  try {
    const cleanMembers = members
      .map((m) => String(m).trim())
      .filter((m) => m.length > 0);
    if (cleanMembers.length === 0) return;
    await redisConnection.sadd(key, ...cleanMembers);
  } catch (error) {
    logger.warn(
      `[Cache] Failed to add members to set "${key}":`,
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Retrieves all members of a Redis set.
 */
export async function getSetMembers(key: string): Promise<string[]> {
  try {
    return await redisConnection.smembers(key);
  } catch (error) {
    logger.warn(
      `[Cache] Failed to read members from set "${key}":`,
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}

/**
 * Removes one or more members from a Redis set.
 */
export async function removeFromSet(
  key: string,
  ...members: Array<string | number>
): Promise<void> {
  try {
    const cleanMembers = members
      .map((m) => String(m).trim())
      .filter((m) => m.length > 0);
    if (cleanMembers.length === 0) return;
    await redisConnection.srem(key, ...cleanMembers);
  } catch (error) {
    logger.warn(
      `[Cache] Failed to remove members from set "${key}":`,
      error instanceof Error ? error.message : error,
    );
  }
}
