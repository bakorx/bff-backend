import { Types } from "mongoose";
import { logger } from "@/config";
import { runInTransaction } from "@/utils";
import { FeatureFlag, FeatureFlagAudit } from "./models";
import { IFeatureFlag, FlagType } from "./interfaces";

const warnedMissingFlags = new Set<string>();

// ---------------------------------------------------------------------------
// Cache: lazy-populated, invalidated on write. Keyed by flag.key.
// ---------------------------------------------------------------------------

interface CacheEntry {
  flag: IFeatureFlag | null;
  expiresAt: number;
}

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, CacheEntry>();

const readFromCache = (key: string): IFeatureFlag | null | undefined => {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.flag;
};

const writeToCache = (key: string, flag: IFeatureFlag | null): void => {
  cache.set(key, {
    flag,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
};

export const invalidateFlagCache = (key: string): void => {
  cache.delete(key);
};

// ---------------------------------------------------------------------------
// Rollout bucketing: deterministic, hash(key:userId) % 100.
// ---------------------------------------------------------------------------

const fnv1a = (input: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const userBucket = (flagKey: string, userId: string): number => {
  const hash = fnv1a(`${flagKey}:${userId}`);
  return (hash % 100) + 1; // 1..100
};

// ---------------------------------------------------------------------------
// Read path
// ---------------------------------------------------------------------------

const fetchFlagFromDb = async (
  key: string,
): Promise<IFeatureFlag | null> => {
  return FeatureFlag.findOne({ key }).lean<IFeatureFlag>().exec();
};

const loadFlag = async (key: string): Promise<IFeatureFlag | null> => {
  const cached = readFromCache(key);
  if (cached !== undefined) return cached;
  const fresh = await fetchFlagFromDb(key);
  writeToCache(key, fresh);
  return fresh;
};

const warnIfMissing = (key: string): void => {
  if (warnedMissingFlags.has(key)) return;
  warnedMissingFlags.add(key);
  logger.warn(
    `[features] Flag "${key}" is missing — treating as disabled. ` +
      `Create it via /admin/features.`,
  );
};

export const isEnabled = async (key: string): Promise<boolean> => {
  const flag = await loadFlag(key);
  if (!flag) {
    warnIfMissing(key);
    return false;
  }
  return flag.enabled;
};

export const isEnabledForUser = async (
  key: string,
  userId: string,
): Promise<boolean> => {
  const flag = await loadFlag(key);
  if (!flag) {
    warnIfMissing(key);
    return false;
  }
  if (!flag.enabled) return false;
  if (flag.type === "percentage") {
    const pct = typeof flag.value === "number" ? flag.value : 100;
    if (pct >= 100) return true;
    if (pct <= 0) return false;
    return userBucket(key, userId) <= pct;
  }
  return true;
};

const requireFlag = async <T extends FlagType>(
  key: string,
  expected: T,
): Promise<IFeatureFlag> => {
  const flag = await loadFlag(key);
  if (!flag) {
    throw new Error(`Feature flag "${key}" is not configured`);
  }
  if (flag.type !== expected) {
    throw new Error(
      `Feature flag "${key}" is type "${flag.type}", expected "${expected}"`,
    );
  }
  return flag;
};

export const getString = async (key: string): Promise<string> => {
  const flag = await requireFlag(key, "select");
  if (typeof flag.value !== "string") {
    throw new Error(`Feature flag "${key}" has no string value set`);
  }
  return flag.value;
};

export const getSelect = async <T extends string>(
  key: string,
): Promise<T> => {
  const value = await getString(key);
  return value as T;
};

export const getJson = async <T = Record<string, unknown>>(
  key: string,
): Promise<T> => {
  const flag = await requireFlag(key, "json");
  if (!flag.config || typeof flag.config !== "object") {
    throw new Error(`Feature flag "${key}" has no config set`);
  }
  return flag.config as T;
};

export const getPercentageValue = async (key: string): Promise<number> => {
  const flag = await requireFlag(key, "percentage");
  if (typeof flag.value !== "number") {
    throw new Error(`Feature flag "${key}" has no numeric value set`);
  }
  return flag.value;
};

// ---------------------------------------------------------------------------
// Admin write path — used by controllers
// ---------------------------------------------------------------------------

export interface CreateFlagInput {
  key: string;
  name: string;
  description: string;
  type: FlagType;
  enabled?: boolean;
  value?: number | string;
  options?: string[];
  config?: Record<string, unknown>;
}

export const createFlag = async (
  input: CreateFlagInput,
  performedBy: string,
  reason?: string,
) => {
  return runInTransaction(async (session) => {
    const existing = await FeatureFlag.findOne({ key: input.key })
      .session(session)
      .lean();
    if (existing) {
      throw new Error(`Feature flag "${input.key}" already exists`);
    }

    const flagDoc = new FeatureFlag({
      key: input.key,
      name: input.name,
      description: input.description,
      type: input.type,
      enabled: input.enabled ?? false,
      value: input.value ?? null,
      options: input.options,
      config: input.config,
      updatedBy: new Types.ObjectId(performedBy),
    });
    const created = await flagDoc.save({ session });

    const auditDoc = new FeatureFlagAudit({
      flagKey: input.key,
      action: "create",
      before: null,
      after: created.toObject(),
      performedBy: new Types.ObjectId(performedBy),
      reason: reason ?? null,
    });
    await auditDoc.save({ session });

    invalidateFlagCache(input.key);
    return created.toObject();
  });
};

export interface UpdateFlagInput {
  name?: string;
  description?: string;
  enabled?: boolean;
  value?: number | string | null;
  options?: string[];
  config?: Record<string, unknown>;
  reason?: string;
}

export const updateFlag = async (
  key: string,
  patch: UpdateFlagInput,
  performedBy: string,
) => {
  return runInTransaction(async (session) => {
    const before = await FeatureFlag.findOne({ key })
      .session(session)
      .lean();
    if (!before) {
      throw new Error(`Feature flag "${key}" not found`);
    }

    const $set: Record<string, unknown> = {
      updatedBy: new Types.ObjectId(performedBy),
    };
    if (patch.name !== undefined) $set.name = patch.name;
    if (patch.description !== undefined) $set.description = patch.description;
    if (patch.enabled !== undefined) $set.enabled = patch.enabled;
    if (patch.value !== undefined) $set.value = patch.value ?? null;
    if (patch.options !== undefined) $set.options = patch.options;
    if (patch.config !== undefined) $set.config = patch.config;

    const updated = await FeatureFlag.findOneAndUpdate(
      { key },
      { $set },
      { returnDocument: "after", session },
    ).lean();

    if (!updated) {
      throw new Error(`Feature flag "${key}" not found`);
    }

    const action =
      patch.enabled === true
        ? "enable"
        : patch.enabled === false
          ? "disable"
          : "update";

    const auditDoc = new FeatureFlagAudit({
      flagKey: key,
      action,
      before,
      after: updated,
      performedBy: new Types.ObjectId(performedBy),
      reason: patch.reason ?? null,
    });
    await auditDoc.save({ session });

    invalidateFlagCache(key);
    return updated;
  });
};

export const deleteFlag = async (
  key: string,
  performedBy: string,
  reason?: string,
) => {
  await runInTransaction(async (session) => {
    const before = await FeatureFlag.findOne({ key })
      .session(session)
      .lean();
    if (!before) {
      throw new Error(`Feature flag "${key}" not found`);
    }
    await FeatureFlag.deleteOne({ key }).session(session);
    const auditDoc = new FeatureFlagAudit({
      flagKey: key,
      action: "delete",
      before,
      after: null,
      performedBy: new Types.ObjectId(performedBy),
      reason: reason ?? null,
    });
    await auditDoc.save({ session });
    invalidateFlagCache(key);
  });
};

// ---------------------------------------------------------------------------
// Audit history (paginated)
// ---------------------------------------------------------------------------

export interface GetAuditOptions {
  page?: number;
  limit?: number;
}

export const getAuditForFlag = async (
  key: string,
  options: GetAuditOptions = {},
) => {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(100, Math.max(1, options.limit ?? 20));
  const skip = (page - 1) * limit;

  const [rows, total] = await Promise.all([
    FeatureFlagAudit.find({ flagKey: key })
      .sort({ performedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    FeatureFlagAudit.countDocuments({ flagKey: key }),
  ]);

  return {
    data: rows,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
};

// ---------------------------------------------------------------------------
// AI Feature Flags Service
// ---------------------------------------------------------------------------

export interface AIFeatureFlags {
  provider?: string;
  tierOverride?: "auto" | "free" | "paid";
  allowFreeUserPaid?: boolean;
}

/**
 * Single batch DB query to load all AI feature flags.
 * Returns undefined for any flag that is missing, disabled, or if DB is offline.
 */
export const getAIFeatureFlags = async (): Promise<AIFeatureFlags> => {
  const result: AIFeatureFlags = {
    provider: undefined,
    tierOverride: undefined,
    allowFreeUserPaid: undefined,
  };

  try {
    const flags = await FeatureFlag.find({
      key: { $in: ["ai_provider", "ai_tier_override", "ai_allow_free_users_paid_models"] },
    }).lean();

    for (const flag of flags) {
      if (flag.key === "ai_provider" && flag.enabled && typeof flag.value === "string") {
        result.provider = flag.value;
      } else if (flag.key === "ai_tier_override" && flag.enabled && typeof flag.value === "string") {
        result.tierOverride = flag.value as "auto" | "free" | "paid";
      } else if (flag.key === "ai_allow_free_users_paid_models") {
        result.allowFreeUserPaid = Boolean(flag.enabled);
      }
    }
  } catch {
    // If DB is offline or not connected, returns undefined fields
  }

  return result;
};
