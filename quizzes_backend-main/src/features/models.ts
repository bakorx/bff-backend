import { Schema, model, Model } from "mongoose";
import { IFeatureFlag, IFeatureFlagAudit } from "./interfaces";

const FeatureFlagSchema = new Schema<IFeatureFlag>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: /^[a-z][a-z0-9_]*$/,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    type: {
      type: String,
      required: true,
      enum: ["boolean", "percentage", "select", "json"],
    },
    enabled: { type: Boolean, required: true, default: false },
    value: { type: Schema.Types.Mixed, default: null },
    options: { type: [String], default: undefined },
    config: { type: Schema.Types.Mixed, default: undefined },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

FeatureFlagSchema.index({ type: 1, enabled: 1 });

export const FeatureFlag: Model<IFeatureFlag> = model<IFeatureFlag>(
  "FeatureFlag",
  FeatureFlagSchema,
);

const FeatureFlagAuditSchema = new Schema<IFeatureFlagAudit>(
  {
    flagKey: { type: String, required: true, trim: true, lowercase: true },
    action: {
      type: String,
      required: true,
      enum: ["create", "update", "delete", "enable", "disable"],
    },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    performedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    performedAt: { type: Date, required: true, default: Date.now },
    reason: { type: String, default: null },
  },
  { timestamps: false },
);

FeatureFlagAuditSchema.index({ flagKey: 1, performedAt: -1 });
FeatureFlagAuditSchema.index({ performedAt: -1 });

export const FeatureFlagAudit: Model<IFeatureFlagAudit> =
  model<IFeatureFlagAudit>("FeatureFlagAudit", FeatureFlagAuditSchema);
