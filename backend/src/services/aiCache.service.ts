// src/services/aiCache.service.ts
import crypto from "crypto";
import redis from "./redis.service";
import { incrQuestion, incrQuiz } from "./popular.service";

const QNA_TTL_SECONDS = 7 * 24 * 60 * 60;   // 7 days
const QUIZ_TTL_SECONDS = 14 * 24 * 60 * 60; // 14 days

function norm(s: string) {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}
function h(s: string) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

// ---------- Q&A ----------
function qnaKey(normalizedQ: string) {
  return `ai:cache:qna:${h(normalizedQ)}`;
}

export async function getCachedAnswer(question: string): Promise<string | null> {
  const nq = norm(question);
  const key = qnaKey(nq);
  console.log("[CACHE] GET", key);
  const ans = await redis.get(key);
  console.log("[CACHE] GET result:", ans ? `HIT (${ans.length} chars)` : "MISS");
  return ans ?? null;
}

export async function setCachedAnswer(question: string, answer: string): Promise<void> {
  const nq = norm(question);
  const key = qnaKey(nq);
  console.log("[CACHE] SET", key, `(EX ${QNA_TTL_SECONDS}s)`);
  await redis.set(key, answer, "EX", QNA_TTL_SECONDS);
  await incrQuestion(question);
  console.log("[CACHE] incrQuestion OK");
}

// ---------- QUIZ (MCQ-only: 5 items, 4 options, 1 correctIndex) ----------
export type QuizItem = {
  id: string;
  question: string;
  options: [string, string, string, string]; // fixed tuple of 4
  correctIndex: number; // 0..3
};
export type QuizPayload = {
  topic: string;
  level: string;
  items: QuizItem[]; // exactly 5
};

function quizKey(topic: string, level: string) {
  const t = norm(topic);
  const l = norm(level);
  return `ai:cache:quiz:${h(`${t}|${l}`)}`;
}

export async function getCachedQuiz(topic: string, level: string): Promise<QuizPayload | null> {
  const key = quizKey(topic, level);
  console.log("[CACHE] GET", key);
  const raw = await redis.get(key);
  console.log("[CACHE] GET result:", raw ? `HIT (${raw.length} chars)` : "MISS");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as QuizPayload;
  } catch (e) {
    console.error("[CACHE] JSON.parse error:", e);
    return null;
  }
}

export async function setCachedQuiz(topic: string, level: string, quiz: QuizPayload): Promise<void> {
  const key = quizKey(topic, level);
  const payload = JSON.stringify(quiz);
  console.log("[CACHE] SET", key, `(len ${payload.length}) (EX ${QUIZ_TTL_SECONDS}s)`);
  await redis.set(key, payload, "EX", QUIZ_TTL_SECONDS);
  await incrQuiz(topic, level);
  console.log("[CACHE] incrQuiz OK");
}
