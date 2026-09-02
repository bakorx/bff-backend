import type { Request, Response } from "express";
import { sendSuccess } from "@/utils";
import { CONFIG } from "@/config";
import { gatherHistory, gatherIncidents, gatherStatus } from "./services";
import { toAtlassianShape } from "./serializers";

/**
 * GET /api/v1/status — FE-facing payload, wrapped in the standard
 * `{ success, message, data }` envelope via sendSuccess.
 */
export const getStatus = async (_req: Request, res: Response): Promise<void> => {
  const payload = await gatherStatus();
  res.setHeader("Cache-Control", "public, max-age=15");
  sendSuccess(res, "Current platform status", payload);
};

/**
 * GET /api/v1/status/history?hours=24 — hourly bucket rollup of the last
 * `hours` hours (default 24, max 24 since that's all we keep). Used by the
 * FE 24h timeline strip.
 */
export const getStatusHistory = async (req: Request, res: Response): Promise<void> => {
  const raw = Number.parseInt(String(req.query.hours ?? "24"), 10);
  const hours = Math.min(24, Math.max(1, Number.isFinite(raw) ? raw : 24));
  const payload = await gatherHistory(hours);
  res.setHeader("Cache-Control", "public, max-age=60");
  sendSuccess(res, "24h status history", payload);
};

/**
 * GET /api/v1/status/incidents?hours=24 — compressed non-operational runs
 * per component. Drives the "Past incidents" collapsible feed on the FE.
 */
export const getStatusIncidents = async (req: Request, res: Response): Promise<void> => {
  const raw = Number.parseInt(String(req.query.hours ?? "24"), 10);
  const hours = Math.min(24, Math.max(1, Number.isFinite(raw) ? raw : 24));
  const payload = await gatherIncidents(hours);
  res.setHeader("Cache-Control", "public, max-age=60");
  sendSuccess(res, "Incident runs in window", payload);
};

/**
 * GET /status.json — public Atlassian-compatible feed.
 *
 * Sends raw JSON (NOT via sendSuccess) because external monitors expect a
 * flat top-level object: { page, status, components }. CORS is wide open
 * here on purpose — this endpoint is meant to be read from anywhere.
 */
export const getPublicStatusFeed = async (_req: Request, res: Response): Promise<void> => {
  const payload = await gatherStatus();
  const pageUrl = `${CONFIG.FRONTEND_URL ?? "https://qz.bflabs.tech"}/status`;
  const feed = toAtlassianShape(payload, pageUrl);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=15");
  res.status(200).json(feed);
};
