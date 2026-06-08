import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { EvalCase, Judgement, SystemRun } from "./types.js";

export const JUDGE_MODEL = "claude-haiku-4-5-20251001";
const JUDGE_MAX_TOKENS = 256;

const CorrectnessSchema = z.object({
  correct: z.boolean(),
  reason: z.string(),
});

const GroundednessSchema = z.object({
  grounded: z.boolean(),
  reason: z.string(),
});

function extractText(
  content: ReadonlyArray<Anthropic.Messages.ContentBlock>,
): string {
  const out: string[] = [];
  for (const block of content) {
    if (block.type === "text") out.push(block.text);
  }
  return out.join("\n").trim();
}

/**
 * Best-effort extraction of the first JSON object from a model response.
 * The judge prompt asks for strict JSON, but Haiku will sometimes wrap it
 * in prose; we grab the first `{...}` block and try `JSON.parse`.
 */
function firstJsonObject(raw: string): unknown {
  const start = raw.indexOf("{");
  if (start < 0) throw new Error("no '{' found in judge output");
  // Walk forward tracking brace depth to find the matching close.
  let depth = 0;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const slice = raw.slice(start, i + 1);
        return JSON.parse(slice);
      }
    }
  }
  throw new Error("unterminated JSON object in judge output");
}

async function ask(
  anthropic: Anthropic,
  prompt: string,
): Promise<string> {
  const response = await anthropic.messages.create({
    model: JUDGE_MODEL,
    max_tokens: JUDGE_MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  });
  return extractText(response.content);
}

function correctnessPrompt(expected: string, generated: string): string {
  return [
    "You are grading whether a generated answer is factually consistent with an expected answer.",
    "",
    `Expected: ${expected}`,
    "",
    `Generated: ${generated}`,
    "",
    'Respond with JSON only: {"correct": boolean, "reason": string}. No prose outside the JSON.',
  ].join("\n");
}

function groundednessPrompt(context: string, generated: string): string {
  return [
    "You are grading whether every claim in a generated answer is supported by the supplied context.",
    "If the answer truthfully says it does not know because the context is insufficient, that counts as grounded.",
    "",
    `Context:\n${context}`,
    "",
    `Generated: ${generated}`,
    "",
    'Respond with JSON only: {"grounded": boolean, "reason": string}. No prose outside the JSON.',
  ].join("\n");
}

export async function judge(
  caseRow: EvalCase,
  run: SystemRun,
  anthropic: Anthropic,
): Promise<Judgement> {
  let correct = false;
  let correctReason = "judge parse error";
  try {
    const raw = await ask(
      anthropic,
      correctnessPrompt(caseRow.expected, run.finalText),
    );
    const parsed = CorrectnessSchema.parse(firstJsonObject(raw));
    correct = parsed.correct;
    correctReason = parsed.reason;
  } catch (err) {
    correctReason = `judge parse error: ${err instanceof Error ? err.message : String(err)}`;
  }

  let grounded = false;
  let groundedReason = "judge parse error";
  try {
    const raw = await ask(
      anthropic,
      groundednessPrompt(run.contextSentToJudge, run.finalText),
    );
    const parsed = GroundednessSchema.parse(firstJsonObject(raw));
    grounded = parsed.grounded;
    groundedReason = parsed.reason;
  } catch (err) {
    groundedReason = `judge parse error: ${err instanceof Error ? err.message : String(err)}`;
  }

  return {
    caseId: caseRow.id,
    system: run.system,
    correct,
    correctReason,
    grounded,
    groundedReason,
  };
}
