import { Router } from "express";
import { incidentReportLimiter } from "@/middlewares";
import { getIncidentReports, postIncidentReport } from "./controllers";

/**
 * Mounted at /api/v1/status/reports in ../routes.ts. Public — no auth.
 *
 * GET is uncapped (read-only public feed). POST is rate-limited to 5/hour/IP
 * via `incidentReportLimiter` — the global Limiter skips /status* entirely
 * for external monitors, so we apply a targeted limiter just to writes.
 */
const router = Router();
router.get("/", getIncidentReports);
router.post("/", incidentReportLimiter, postIncidentReport);

export { router as reportsRouter };
