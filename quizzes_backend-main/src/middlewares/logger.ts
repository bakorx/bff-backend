import { Request, Response, NextFunction } from "express";
import { logger } from "@/config";

export const Logger = (req: Request, res: Response, next: NextFunction) => {
  try {
    const { method, originalUrl, ip } = req;
    const userAgent = req.headers["user-agent"] || "unknown";
    res.on("finish", () => {
      logger.info(
        `[Middleware] ${method} ${originalUrl} [${res.statusCode}] - IP: ${ip} - User-Agent: ${userAgent}`,
      );
    });
    next();
  } catch (err: any) {
    next(err.message);
  }
};
