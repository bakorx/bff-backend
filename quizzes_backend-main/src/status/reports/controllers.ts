import type { Request, Response } from "express";
import { sendSuccess } from "@/utils";
import { z } from "zod";
import { listReports, submitReport } from "./services";
import type { ComponentId } from "../interfaces";
import type { ReportSeverity } from "./interfaces";

const ComponentIdEnum = z.enum(["mongodb", "redis", "openrouter", "api"]);

/**
 * GET /api/v1/status/reports?componentId=&limit= — public recent community
 * reports. Cached 30s on the FE — fresh enough for a useful signal, lazy
 * enough that a tight poll loop doesn't hammer Mongo.
 */
export const getIncidentReports = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const rawLimit = Number.parseInt(String(req.query.limit ?? "50"), 10);
  const limit = Math.min(
    50,
    Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 50),
  );
  const componentIdRaw = String(req.query.componentId ?? "").trim();
  const parsedId =
    componentIdRaw === ""
      ? undefined
      : ComponentIdEnum.safeParse(componentIdRaw);
  const componentId =
    parsedId && parsedId.success ? (parsedId.data as ComponentId) : undefined;
  const payload = await listReports(componentId, limit);
  res.setHeader("Cache-Control", "public, max-age=30");
  sendSuccess(res, "Recent community reports", payload);
};

const SubmitReportSchema = z.object({
  componentId: ComponentIdEnum,
  severity: z.enum(["slow", "down"]),
  description: z
    .string()
    .trim()
    .min(10, "Tell us a bit more — at least 10 characters")
    .max(500, "Keep it under 500 characters"),
  reporterName: z
    .string()
    .trim()
    .max(80, "Name must be at most 80 characters")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  reporterEmail: z
    .string()
    .trim()
    .email("That doesn't look like an email address")
    .max(200, "Email must be at most 200 characters")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

/**
 * POST /api/v1/status/reports — submit an incident report. Public, anonymous.
 * Rate-limited to 5/hour/IP via `incidentReportLimiter` mounted on the route.
 */
export const postIncidentReport = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const parsed = SubmitReportSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    res.status(400).json({
      error: "INVALID_REPORT",
      message: issue?.message ?? "Invalid report payload",
      field: issue?.path?.[0],
    });
    return;
  }

  const report = await submitReport(
    {
      componentId: parsed.data.componentId as ComponentId,
      severity: parsed.data.severity as ReportSeverity,
      description: parsed.data.description,
      reporterName: parsed.data.reporterName,
      reporterEmail: parsed.data.reporterEmail,
    },
    {
      ip: req.ip ?? "unknown",
      userAgent: req.headers["user-agent"] ?? "unknown",
    },
  );

  sendSuccess(res, "Report submitted — thank you!", report, undefined, 201);
};
