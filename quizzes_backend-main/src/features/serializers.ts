import { z } from "zod";

const FlagKeySchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, "Key must be snake_case starting with a letter")
  .describe("Unique flag identifier (e.g. weekly_digest_enabled)");

const baseShape = {
  key: FlagKeySchema.optional(),
  name: z.string().min(2).max(120).optional(),
  description: z.string().min(2).max(500).optional(),
  type: z.enum(["boolean", "percentage", "select", "json"]).optional(),
  enabled: z.boolean().optional(),
};

export const FeatureFlagCreateSerializer = z
  .object({
    key: FlagKeySchema,
    name: z.string().min(2).max(120),
    description: z.string().min(2).max(500),
    type: z.enum(["boolean", "percentage", "select", "json"]),
    enabled: z.boolean().default(false),
    value: z
      .union([z.string(), z.number()])
      .optional()
      .describe(
        "For `percentage`: 0-100 number. For `select`: one of `options`.",
      ),
    options: z
      .array(z.string().min(1))
      .optional()
      .describe("Allowed values for `select` flags"),
    config: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Free-form config for `json` flags"),
  })
  .superRefine((data, ctx) => {
    if (data.type === "percentage") {
      if (typeof data.value !== "number" || data.value < 0 || data.value > 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Percentage flags require `value` between 0 and 100",
          path: ["value"],
        });
      }
    }
    if (data.type === "select") {
      if (
        !Array.isArray(data.options) ||
        data.options.length === 0 ||
        typeof data.value !== "string" ||
        !data.options.includes(data.value)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Select flags require `value` to be one of `options`",
          path: ["value"],
        });
      }
    }
    if (data.type === "json") {
      if (data.value !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "JSON flags do not use `value`; use `config` instead",
          path: ["value"],
        });
      }
      if (!data.config || typeof data.config !== "object") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "JSON flags require a non-empty `config` object",
          path: ["config"],
        });
      }
    }
  })
  .describe("Create a new feature flag");

export const FeatureFlagUpdateSerializer = z
  .object({
    name: z.string().min(2).max(120).optional(),
    description: z.string().min(2).max(500).optional(),
    enabled: z.boolean().optional(),
    value: z.union([z.string(), z.number()]).optional(),
    options: z.array(z.string().min(1)).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    reason: z.string().max(280).optional(),
  })
  .describe("Partial update for a feature flag");

export const FeatureFlagSerializer = z
  .object({
    key: FlagKeySchema,
    name: z.string(),
    description: z.string(),
    type: z.enum(["boolean", "percentage", "select", "json"]),
    enabled: z.boolean(),
    value: z.union([z.string(), z.number()]).nullable().optional(),
    options: z.array(z.string()).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    updatedAt: z.date(),
    createdAt: z.date(),
    updatedBy: z.string().nullable().optional(),
  })
  .describe("Feature flag");

export const FeatureFlagAuditSerializer = z
  .object({
    flagKey: z.string(),
    action: z.enum(["create", "update", "delete", "enable", "disable"]),
    before: z.record(z.string(), z.unknown()).nullable().optional(),
    after: z.record(z.string(), z.unknown()).nullable().optional(),
    performedBy: z.string(),
    performedAt: z.date(),
    reason: z.string().nullable().optional(),
  })
  .describe("Audit entry for a feature flag change");

export { baseShape as FeatureFlagBaseShape };
