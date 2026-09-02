import mongoose, { Schema, model, Types } from "mongoose";
import type { Document } from "mongoose";
import type { ComponentId } from "../interfaces";
import type { ReportSeverity } from "./interfaces";

/**
 * User-submitted incident reports. Public, anonymous by default, with optional
 * email/name for follow-up. TTL-indexed at 7 days — long enough to spot
 * patterns, short enough that stale reports don't haunt the public feed.
 */
export interface IIncidentReport extends Document {
  componentId: ComponentId;
  severity: ReportSeverity;
  description: string;
  reporterName?: string;
  reporterEmail?: string;
  ip: string;
  userAgent: string;
  createdAt: Date;
  _id: Types.ObjectId;
}

const IncidentReportSchema = new Schema<IIncidentReport>(
  {
    componentId: {
      type: String,
      enum: ["mongodb", "redis", "openrouter", "api"],
      required: true,
    },
    severity: {
      type: String,
      enum: ["slow", "down"],
      required: true,
    },
    description: { type: String, required: true, maxlength: 500 },
    reporterName: { type: String, default: undefined, maxlength: 80 },
    reporterEmail: { type: String, default: undefined, maxlength: 200 },
    ip: { type: String, required: true },
    userAgent: { type: String, required: true, maxlength: 500 },
    createdAt: { type: Date, required: true},
  },
  { versionKey: false },
);

// TTL — reports auto-prune after 7 days.
IncidentReportSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 7 },
);

// Drives the public "Recent community reports" feed sorted newest-first.
IncidentReportSchema.index({ componentId: 1, createdAt: -1 });

export const IncidentReportModel = model<IIncidentReport>(
  "IncidentReport",
  IncidentReportSchema,
);
