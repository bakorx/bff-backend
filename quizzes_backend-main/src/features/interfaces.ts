import { Document, Types } from "mongoose";

export type FlagType = "boolean" | "percentage" | "select" | "json";

export type FlagAuditAction =
  | "create"
  | "update"
  | "delete"
  | "enable"
  | "disable";

export interface IFeatureFlag extends Document {
  key: string;
  name: string;
  description: string;
  type: FlagType;
  enabled: boolean;
  /** percentage (0-100) for `percentage` flags; selected option for `select` flags. */
  value?: number | string | null;
  /** Allowed values for `select` flags. */
  options?: string[];
  /** Free-form config for `json` flags. */
  config?: Record<string, unknown>;
  updatedAt: Date;
  createdAt: Date;
  updatedBy?: Types.ObjectId | null;
}

export interface IFeatureFlagAudit extends Document {
  flagKey: string;
  action: FlagAuditAction;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  performedBy: Types.ObjectId;
  performedAt: Date;
  reason?: string | null;
}
