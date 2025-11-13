// src/controllers/ai.qa.controller.ts
import { Request, Response } from "express";
import { getCachedAnswer, setCachedAnswer } from "../services/aiCache.service";
import { askOpenAIQuestion } from "../services/openai.service";

export async function qaAnswer(req: Request, res: Response) {
  const q = (req.body?.question ?? "").toString();
  console.log("[QA] Incoming question:", q);

  try {
    if (!q.trim()) {
      console.warn("[QA] Missing question");
      return res.status(400).json({ error: "Missing question" });
    }

    // 1) Cache lookup
    const cached = await getCachedAnswer(q);
    if (cached) {
      console.log("[QA] Cache HIT → returning cached answer");
      return res.json({ cached: true, answer: cached });
    }
    console.log("[QA] Cache MISS → calling OpenAI");

    // 2) OpenAI
    const answer = await askOpenAIQuestion(q);
    console.log("[QA] OpenAI answer length:", answer?.length);

    if (!answer) {
      console.error("[QA] OpenAI returned empty answer");
      return res.status(502).json({ error: "openai_empty_answer" });
    }

    // 3) Save to cache
    await setCachedAnswer(q, answer);
    console.log("[QA] Saved to cache OK");

    return res.json({ cached: false, answer });
  } catch (err: any) {
    console.error("[QA] Error:", err?.message || err);
    return res.status(500).json({ error: "server_error", detail: err?.message || String(err) });
  }
}
