import type { ComponentId } from "../interfaces";

/**
 * User-reported severity. Mirrors the two non-operational ComponentState
 * values but stays a separate type so we can evolve report-specific fields
 * (e.g. "flaky", "partial") without touching the probe classifier.
 */
export type ReportSeverity = "slow" | "down";

/** What the FE POSTs. Validated with Zod at the controller boundary. */
export interface IncidentReportInput {
  componentId: ComponentId;
  severity: ReportSeverity;
  description: string;
  reporterName?: string;
  reporterEmail?: string;
}

/**
 * Public-facing report shape. Email is never exposed — even if the reporter
 * gave one. Only admins (via the dashboard) would see the raw row.
 */
export interface IncidentReport {
  id: string;
  componentId: ComponentId;
  componentLabel: string;
  severity: ReportSeverity;
  description: string;
  reporterName?: string;
  createdAt: string;
}

export interface IncidentReportList {
  reports: IncidentReport[];
  total: number;
}
