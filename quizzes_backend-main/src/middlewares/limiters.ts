import rateLimit from "express-rate-limit";

export const Limiter = rateLimit({
  windowMs: 6 * 60 * 1000,
  limit: 200,
  message: { error: "Too many requests, please try again later" },
  // Skip status endpoints — they're polled by external monitors (UptimeRobot,
  // BetterUptime) every 30–60s from fixed IPs, and by the FE ISR loop.
  // Without this bypass they'd burn the per-window quota and get 429s.
  skip: (req) =>
    req.path.startsWith("/status") || req.path.startsWith("/api/v1/status"),
  handler: (req, res) => {
    res
      .status(429)
      .send({ error: "Too many requests, please try again later" });
  },
  legacyHeaders: true,
  standardHeaders: "draft-8",
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  message: {
    error:
      "Too many login attempts from this IP, please try again after 15 minutes",
  },
  handler: (req, res) => {
    res.status(429).send({
      error:
        "Too many login attempts from this IP, please try again after 15 minutes",
    });
  },
  legacyHeaders: true,
  standardHeaders: "draft-8",
});

export const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 3, // 3 requests per window per IP
  message: {
    error: "TOO_MANY_REQUESTS",
    message: "Too many reset attempts. Try again in 15 minutes.",
  },
  handler: (req, res) => {
    res.status(429).send({
      error: "TOO_MANY_REQUESTS",
      message: "Too many reset attempts. Try again in 15 minutes.",
    });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Targeted rate limit for the public incident-report POST endpoint.
 *
 * The global `Limiter` skips `/status*` entirely (because external monitors
 * poll it). We don't want to expose reports to the same bypass, so we apply
 * this limiter directly on the reports route — 5 submissions per hour per IP.
 */
export const incidentReportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5,
  message: {
    error: "TOO_MANY_REPORTS",
    message:
      "You've submitted too many incident reports. Try again in an hour.",
  },
  handler: (req, res) => {
    res.status(429).send({
      error: "TOO_MANY_REPORTS",
      message:
        "You've submitted too many incident reports. Try again in an hour.",
    });
  },
  standardHeaders: true,
  legacyHeaders: false,
});