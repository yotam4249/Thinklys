// src/controllers/ai.quiz.controller.ts
import { Request, Response } from "express";
import {
  getCachedQuiz,
  setCachedQuiz,
  type QuizPayload,
  type QuizItem,
} from "../services/aiCache.service";
import { generateOpenAIQuiz, generateOpenAIQuizStrict } from "../services/openai.service";
import { UserModel } from "../models/user.model";

function isStringArray(arr: any, len: number): arr is string[] {
  return Array.isArray(arr) && arr.length === len && arr.every((x) => typeof x === "string");
}

/** Light repair for minor issues; returns a new object */
function coerceQuizShape(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;
  if (!Array.isArray(obj.items)) return obj;

  const fixed = { ...obj, items: obj.items.map((it: any, idx: number) => ({ ...it })) };

  fixed.items = fixed.items.map((it: any, idx: number) => {
    // Ensure id as string
    if (it.id === undefined || it.id === null) it.id = String(idx + 1);
    else if (typeof it.id !== "string") it.id = String(it.id);

    // Ensure question as string
    if (typeof it.question !== "string") it.question = String(it.question ?? "");

    // Ensure options array of 4 strings
    let opts: string[] = [];
    if (Array.isArray(it.options)) {
      opts = it.options.map((o: any) => String(o)).slice(0, 4);
    }
    while (opts.length < 4) opts.push(`Option ${opts.length + 1}`);

    // Deduplicate options naively if duplicates present
    const seen = new Set<string>();
    opts = opts.map((o) => (seen.has(o) ? `${o} *` : (seen.add(o), o)));

    it.options = opts as [string, string, string, string];

    // Ensure correctIndex is 0..3
    if (typeof it.correctIndex !== "number" || it.correctIndex < 0 || it.correctIndex > 3) {
      // Attempt recovery if model returned an 'answer' string:
      if (typeof it.answer === "string") {
        const idxAns = opts.findIndex((o) => o.trim().toLowerCase() === it.answer.trim().toLowerCase());
        it.correctIndex = idxAns >= 0 ? idxAns : 0;
      } else {
        it.correctIndex = 0;
      }
    } else {
      it.correctIndex = Math.floor(it.correctIndex) % 4;
    }

    return it;
  });

  // Trim to exactly 5 items
  if (fixed.items.length > 5) fixed.items = fixed.items.slice(0, 5);
  while (fixed.items.length < 5) {
    const i = fixed.items.length;
    fixed.items.push({
      id: String(i + 1),
      question: `Placeholder question ${i + 1}?`,
      options: ["A", "B", "C", "D"],
      correctIndex: 0,
    });
  }

  return fixed;
}

/** Strict validation: exactly 5 items, 4 options each, correctIndex in [0,3] */
function isValidQuizShape(obj: any): obj is QuizPayload {
  if (!obj || typeof obj !== "object") return false;
  if (typeof obj.topic !== "string" || typeof obj.level !== "string") return false;
  if (!Array.isArray(obj.items) || obj.items.length !== 5) return false;
  for (const it of obj.items) {
    if (typeof it?.id !== "string") return false;
    if (typeof it?.question !== "string") return false;
    if (!isStringArray(it?.options, 4)) return false;
    if (typeof it?.correctIndex !== "number") return false;
    if (it.correctIndex < 0 || it.correctIndex > 3) return false;
  }
  return true;
}

export async function quizGenerate(req: Request, res: Response) {
  const topic = (req.body?.topic ?? "").toString();
  const level = (req.body?.level ?? "").toString();
  console.log("[QUIZ] Incoming:", { topic, level });

  try {
    if (!topic.trim() || !level.trim()) {
      console.warn("[QUIZ] Missing topic/level");
      return res.status(400).json({ error: "Missing topic/level" });
    }

    // 1) Cache
    const cached = await getCachedQuiz(topic, level);
    if (cached) {
      console.log("[QUIZ] Cache HIT → returning cached quiz");
      return res.json({ cached: true, quiz: cached });
    }
    console.log("[QUIZ] Cache MISS → calling OpenAI (normal)");

    // 2) Attempt 1 (normal)
    let jsonStr = await generateOpenAIQuiz(topic, level);
    console.log("[QUIZ] OpenAI (normal) JSON len:", jsonStr?.length);

    let parsed: any = null;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      console.error("[QUIZ] JSON.parse failed (normal):", e);
    }
    if (parsed) parsed = coerceQuizShape(parsed);

    if (!parsed || !isValidQuizShape(parsed)) {
      console.warn("[QUIZ] Shape invalid after normal attempt; retry STRICT");
      // 3) Attempt 2 (strict)
      const strictStr = await generateOpenAIQuizStrict(topic, level);
      console.log("[QUIZ] OpenAI (strict) JSON len:", strictStr?.length);

      try {
        parsed = JSON.parse(strictStr);
      } catch (e) {
        console.error("[QUIZ] JSON.parse failed (strict):", e);
        return res.status(502).json({ error: "openai_bad_json" });
      }
      parsed = coerceQuizShape(parsed);

      const ok2 = isValidQuizShape(parsed);
      console.log("[QUIZ] strict shape valid?", ok2);
      if (!ok2) {
        console.error("[QUIZ] Shape invalid after strict retry; sample:", JSON.stringify(parsed)?.slice(0, 400));
        return res.status(502).json({ error: "openai_shape_invalid", data: parsed });
      }
    }

    // 4) Save & return (answers included via correctIndex)
    await setCachedQuiz(topic, level, parsed);
    console.log("[QUIZ] Saved to cache OK");

    return res.json({ cached: false, quiz: parsed });
  } catch (err: any) {
    console.error("[QUIZ] Error:", err?.message || err);
    return res.status(500).json({ error: "server_error", detail: err?.message || String(err) });
  }
}

export async function quizSaveResult(req: Request, res: Response) {
  try {
    const userId = (req as any)?.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "UNAUTHORIZED" });
    }

    const { topic, level, score, total } = req.body;

    if (!topic || !level || typeof score !== "number" || typeof total !== "number") {
      return res.status(400).json({ error: "Missing required fields: topic, level, score, total" });
    }

    if (score < 0 || total <= 0 || score > total) {
      return res.status(400).json({ error: "Invalid score or total values" });
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "USER_NOT_FOUND" });
    }

    // Add quiz result to history
    user.quizHistory.push({
      topic: String(topic),
      level: String(level),
      score,
      total,
      completedAt: new Date(),
    });

    await user.save();

    return res.json({ 
      success: true,
      quizHistory: user.quizHistory 
    });
  } catch (err: any) {
    console.error("[QUIZ] Save result error:", err?.message || err);
    return res.status(500).json({ error: "server_error", detail: err?.message || String(err) });
  }
}
