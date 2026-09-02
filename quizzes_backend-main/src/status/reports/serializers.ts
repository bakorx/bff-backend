import type { ComponentId } from "../interfaces";
import { COMPONENT_META } from "../constants";
import type { IncidentReport } from "./interfaces";

/**
 * Mongoose doc → public API shape. Strips `ip`, `userAgent`, and
 * `reporterEmail` — those are admin/debug only.
 */
export function toPublicReport(doc: {
  _id: { toString(): string };
  componentId: ComponentId;
  severity: "slow" | "down";
  description: string;
  reporterName?: string;
  createdAt: Date;
}): IncidentReport {
  return {
    id: doc._id.toString(),
    componentId: doc.componentId,
    componentLabel: COMPONENT_META[doc.componentId].label,
    severity: doc.severity,
    description: doc.description,
    reporterName: doc.reporterName,
    createdAt: doc.createdAt.toISOString(),
  };
}
