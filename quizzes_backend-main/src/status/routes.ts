import { Router } from "express";
import {
  getStatus,
  getPublicStatusFeed,
  getStatusHistory,
  getStatusIncidents,
} from "./controllers";
import { reportsRouter } from "./reports";

/**
 * Mounted at /api/v1/status in server.ts. Public — no auth.
 */
const publicRouter = Router();
publicRouter.get("/", getStatus);
publicRouter.get("/history", getStatusHistory);
publicRouter.get("/incidents", getStatusIncidents);
// Reports submodule owns its own rate-limited POST.
publicRouter.use("/reports", reportsRouter);

/**
 * Mounted at / in server.ts. Only exposes /status.json. Must be mounted
 * BEFORE the catch-all `app.get("/", ...)` HTML handler in server.ts.
 */
const rootRouter = Router();
rootRouter.get("/status.json", getPublicStatusFeed);

export { publicRouter, rootRouter };