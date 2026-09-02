import { createLogger, format, transports } from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { ENV } from "./env";
import path from "path";

const isProduction = ENV.NODE_ENV === "production" || Boolean(process.env.DYNO);

const loggerTransports: any[] = [
  new transports.Console({
    format: format.combine(
      format.timestamp(),
      ...(isProduction ? [] : [format.colorize()]),
      format.printf(
        (info) => `${info.timestamp} ${info.level}: ${info.message}`,
      ),
    ),
  }),
];

// Only enable file rotation in local development (avoid write errors on ephemeral/read-only production environments like Heroku)
if (!isProduction) {
  loggerTransports.push(
    new DailyRotateFile({
      filename: path.isAbsolute(ENV.LOGS.LOG_FILENAME)
        ? ENV.LOGS.LOG_FILENAME
        : path.join(process.cwd(), ENV.LOGS.LOG_FILENAME),
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxSize: "20m",
      maxFiles: "14d",
      level: ENV.LOGS.LOG_LEVEL,
      format: format.combine(
        format.timestamp(),
        format.colorize(),
        format.printf(
          (info) => `${info.timestamp} ${info.level}: ${info.message}`,
        ),
      ),
    }),
  );
}

export const logger = createLogger({
  level: ENV.LOGS.LOG_LEVEL,
  format: format.combine(
    format.timestamp(),
    format.printf(
      (info) => `${info.timestamp} [${info.level} ${info.message}]`,
    ),
  ),
  transports: loggerTransports,
});