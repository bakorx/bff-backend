import express, { Express, Request, Response, NextFunction } from "express";
import path from "path";
import { createServer } from "http";
import { CONFIG, logger, bullBoardAdapter } from "./config";
import swaggerUi from "swagger-ui-express";
import { Limiter, ErrorHandler, Logger, CorsOption } from "./middlewares";
import helmet from "helmet";
import {
  adminRouter as usersAdminRouter,
  publicRouter as usersPublicRouter,
} from "./users/routes";
import {
  adminRouter as learningAdminRouter,
  publicRouter as learningPublicRouter,
} from "./learning/routes";
import {
  adminRouter as aiAdminRouter,
  publicRouter as aiPublicRouter,
} from "./ai/routes";
import {
  adminRouter as subscriptionsAdminRouter,
  publicRouter as subscriptionsPublicRouter,
} from "./subscriptions/routes";
import {
  adminDiscountRouter,
  publicDiscountRouter,
} from "./subscriptions/discount/routes";
import { studentVerifyRouter } from "./subscriptions/student-verify/routes";
import { streakRouter } from "./subscriptions/streak/routes";
import {
  adminRouter as systemAdminRouter,
  publicRouter as systemPublicRouter,
} from "./system/routes";
import { adminRouter as featuresAdminRouter } from "./features/routes";
import crypto from "crypto";
import { authRoutes } from "./auth/routes";
import cors from "cors";
import cookieParser from "cookie-parser";
import { swaggerSpec, asyncapiSpec, asyncapiUiSetup } from "./utils";
import { emailCampaignRouter } from "./email/routes";
import { services as socketServices } from "./socket";
import { pushRouter } from "./push/routes";
import {
  publicRouter as appPublicRouter,
  adminRouter as appAdminRouter,
} from "./app/routes";
import { donationRouter } from "./donations/routes";
import { eventsRouter } from "./events/routes";
import {
  recommendationsRouter,
  adminRecommendationsRouter,
} from "./recommendations/routes";
import { publicRouter as studyRoomsPublicRouter } from "./study_rooms/routes";
import {
  publicRouter as statusPublicRouter,
  rootRouter as statusRootRouter,
} from "./status/routes";
import basicAuth from "express-basic-auth";

const app: Express = express();

interface CustomResponse extends Response {
  locals: {
    nonce?: string;
  };
}

// 🛠️ request body parsers
// Keep webhook body raw for signature validation before global JSON parser.
app.use(
  "/api/v1/subscriptions/payments/webhook",
  express.raw({ type: "application/json" }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use((req: Request, res: CustomResponse, next: NextFunction) => {
  res.locals.nonce = crypto.randomBytes(16).toString("base64");
  next();
});

// 🛠️ security headers
app.disable("x-powered-by");
app.set("trust proxy", 1);

// 🛠️ security and other middleware
app.use(cors(CorsOption));
app.use(helmet());
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-eval'",
          "https://apis.google.com",
          "https://accounts.google.com",
        ],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameSrc: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
  }),
);

app.use(Limiter);

//static files
app.use(express.static(path.join(__dirname, "..", "public")));

app.use(
  "/admin/queues",
  basicAuth({
    users: {
      [CONFIG.BULL_BOARD.USERNAME]: CONFIG.BULL_BOARD.PASSWORD,
    },
    challenge: true,
    realm: "Bull Board",
  }),
  (req: Request, res: Response, next: NextFunction) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data:;",
    );
    next();
  },
  bullBoardAdapter.getRouter(),
);

// Swagger Docs
app.use("/api/v1/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// AsyncAPI Docs (WebSocket events) – JSON spec + browser UI
app.get("/api/v1/asyncapi", (_req: Request, res: Response) => {
  res.json(asyncapiSpec);
});
app.get("/api/v1/asyncapi/docs", asyncapiUiSetup(asyncapiSpec));

// Routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/admin/users", usersAdminRouter);
app.use("/api/v1/users", usersPublicRouter);
app.use("/api/v1/admin/learning", learningAdminRouter);
app.use("/api/v1/learning", learningPublicRouter);
app.use("/api/v1/admin/ai", aiAdminRouter);
app.use("/api/v1/ai", aiPublicRouter);
app.use("/api/v1/admin/subscriptions", subscriptionsAdminRouter);
app.use("/api/v1/subscriptions", subscriptionsPublicRouter);
app.use("/api/v1/admin/subscriptions", adminDiscountRouter);
app.use("/api/v1/subscriptions", publicDiscountRouter);
app.use("/api/v1/subscriptions/student-verify", studentVerifyRouter);
app.use("/api/v1/subscriptions/streak", streakRouter);
app.use("/api/v1/admin/system", systemAdminRouter);
app.use("/api/v1/admin/system/features", featuresAdminRouter);
app.use("/api/v1/system", systemPublicRouter);
app.use("/api/v1/email-campaigns", emailCampaignRouter);
app.use("/api/v1/push", pushRouter);
app.use("/api/v1/admin/app", appAdminRouter);
app.use("/api/v1/app", appPublicRouter);
app.use("/api/v1/donations", donationRouter);
app.use("/api/v1/events", eventsRouter);
app.use("/api/v1/recommendations", recommendationsRouter);
app.use("/api/v1/admin/recommendations", adminRecommendationsRouter);
app.use("/api/v1/study-rooms", studyRoomsPublicRouter);
app.use("/api/v1/status", statusPublicRouter);

// Error Handling & Logging Middleware
app.use(ErrorHandler);
app.use(Logger);

// Status JSON feed — Atlassian-compatible, mounted at root. Must be
// declared BEFORE the catch-all `app.get("/", ...)` HTML handler below.
app.use("/", statusRootRouter);

// Root Route
app.get("/", (req: Request, res: CustomResponse) => {
  const html = path.join(__dirname, "..", "public", "index.html");

  res.setHeader("Content-Security-Policy", "script-src self");

  res.send(html);
});

const server = createServer(app);

export async function startServer() {
  try {
    socketServices.initSocket(server);
    server.listen(CONFIG.PORT, () => {
      if (CONFIG.ENV === "development") {
        logger.info(`[Server] Running at http://localhost:${CONFIG.PORT}`);
      }
    });
  } catch (error) {
    logger.error("[Server] Failed to start", error);
  }
}

export async function stopServer() {
  try {
    server.close();
    logger.info("[Server] Stopped");
  } catch (error) {
    logger.error("[Server] Failed to stop", error);
  }
}
