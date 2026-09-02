import { Redis, RedisOptions } from "ioredis";
import { logger } from "./logger";
import { ENV } from "./env";

const redisOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

if (ENV.REDIS_URL.startsWith("rediss://")) {
  redisOptions.tls = {
    rejectUnauthorized: false,
  };
}

export const redisConnection = new Redis(ENV.REDIS_URL, redisOptions);
export const redisSub = redisConnection.duplicate();

redisConnection.on("error", (error) => {
  logger.error("[Redis] Connection error:", error.message);
});

redisSub.on("error", (error) => {
  logger.error("[Redis:Sub] Subscription connection error:", error.message);
});

redisConnection.on("connect", () => {
  logger.info("[Redis] Connected successfully.");
});

redisSub.on("connect", () => {
  logger.info("[Redis:Sub] Subscription client connected.");
});

redisConnection.on("ready", () => {
  logger.info("[Redis] Ready.");
});
