import Redis from "ioredis";

const url = process.env.REDIS_URL || "redis://localhost:6379";
console.log("[REDIS] connecting to", url);

export const redis = new Redis(url, {
  maxRetriesPerRequest: 2,
});

redis.on("error", (e) => console.error("[REDIS] error:", e));
redis.on("connect", () => console.log("[REDIS] connected"));

export default redis;
