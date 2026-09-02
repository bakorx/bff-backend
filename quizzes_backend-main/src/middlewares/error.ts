import { Request, Response, NextFunction } from "express";
import { logger } from "@/config";

export const ErrorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  logger.error(
    `[Middleware] Error on ${req.method} ${req.url}: ${err.stack || err.message}`,
  );
  res
    .status(500)
    .json({ error: "Something went wrong. Please try again later." });

  next(err.message);
};