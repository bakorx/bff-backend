import { IncidentReportModel } from "./models";
import { toPublicReport } from "./serializers";
import type { ComponentId } from "../interfaces";
import type {
  IncidentReport,
  IncidentReportInput,
  IncidentReportList,
} from "./interfaces";

const MAX_DESCRIPTION = 500;
const MAX_NAME = 80;
const MAX_EMAIL = 200;
const MAX_UA = 500;

interface SubmitReportContext {
  ip: string;
  userAgent: string;
}

/**
 * Validate and persist a user-submitted incident report. Defensive validation
 * here too (in addition to the Zod schema at the controller boundary) so
 * internal callers can't bypass it.
 */
export async function submitReport(
  input: IncidentReportInput,
  ctx: SubmitReportContext,
): Promise<IncidentReport> {
  const description = String(input.description ?? "").trim();
  if (description.length < 10) {
    throw new Error("Description must be at least 10 characters");
  }
  if (description.length > MAX_DESCRIPTION) {
    throw new Error(`Description must be at most ${MAX_DESCRIPTION} characters`);
  }

  const reporterName = sanitizeOptional(input.reporterName, MAX_NAME);
  const reporterEmail = sanitizeOptional(input.reporterEmail, MAX_EMAIL);
  const userAgent = String(ctx.userAgent ?? "").slice(0, MAX_UA) || "unknown";

  const created = await IncidentReportModel.create({
    componentId: input.componentId,
    severity: input.severity,
    description,
    reporterName,
    reporterEmail,
    ip: ctx.ip || "unknown",
    userAgent,
    createdAt: new Date(),
  });

  return toPublicReport(created);
}

/**
 * Recent reports, newest first. Optional componentId filter. Cap at 50 so a
 * single noisy component can't blow up the response.
 */
export async function listReports(
  componentId?: ComponentId,
  limit = 50,
): Promise<IncidentReportList> {
  const safeLimit = Math.min(50, Math.max(1, limit));
  const filter = componentId ? { componentId } : {};
  const [docs, total] = await Promise.all([
    IncidentReportModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(safeLimit)
      .lean(),
    IncidentReportModel.countDocuments(filter),
  ]);
  return {
    reports: docs.map(toPublicReport),
    total,
  };
}

function sanitizeOptional(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, maxLen);
}
