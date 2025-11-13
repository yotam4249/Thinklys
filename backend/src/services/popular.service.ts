import redis from "./redis.service";

const MAX_ZSET_SIZE = 5000;

function norm(s: string) {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

async function trimIfNeeded(key: string) {
  try {
    const size = await redis.zcard(key);
    if (size > MAX_ZSET_SIZE) {
      console.log("[POPULAR] Trimming", key, "size:", size);
      await redis.zremrangebyrank(key, 0, size - MAX_ZSET_SIZE - 1);
    }
  } catch (err) {
    console.warn(`[POPULAR] trim failed for ${key}:`, err);
  }
}

export async function incrQuestion(question: string) {
  const member = norm(question).slice(0, 512);
  if (!member) return;
  console.log("[POPULAR] zincrby questions:", member);
  await redis.zincrby("ai:popular:questions", 1, member);
  trimIfNeeded("ai:popular:questions");
}

export async function incrQuiz(topic: string, level: string) {
  const t = norm(topic).slice(0, 256);
  const l = norm(level).slice(0, 64);
  if (!t || !l) return;
  const member = `${t}|${l}`;
  console.log("[POPULAR] zincrby quizzes:", member);
  await redis.zincrby("ai:popular:quizzes", 1, member);
  trimIfNeeded("ai:popular:quizzes");
}
