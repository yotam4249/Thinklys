import { runAgent } from "../agent/loop.js";
import type { AgentTool } from "../agent/types.js";
import type { ExecutorResult, Subtask } from "./types.js";

const EXECUTOR_SYSTEM_PROMPT = [
  "You are an EXECUTOR in a multi-agent retrieval system.",
  "A planner has assigned you ONE focused subtask of a larger question.",
  "You only have access to a restricted subset of the tools.",
  "Answer the subtask precisely; do NOT try to answer the broader user question — the synthesizer will combine your findings with others.",
  "Cite each fact you report by document_id. If your tools cannot give you the answer, say so explicitly rather than guessing.",
].join(" ");

const MAX_EXECUTOR_STEPS = 6;

/**
 * Run one subtask. Filters `allTools` down to the subtask's `allowedTools`,
 * builds a context-aware question (prefixed with prior subtask findings when
 * the subtask has dependencies), and invokes the existing single-agent loop
 * with a focused system prompt and a tighter step budget.
 */
export async function runExecutor(
  subtask: Subtask,
  allTools: ReadonlyArray<AgentTool>,
  upstreamFindings: ReadonlyMap<string, string>,
): Promise<ExecutorResult> {
  const filteredTools = allTools.filter((t) => subtask.allowedTools.includes(t.name));
  if (filteredTools.length === 0) {
    return {
      subtaskId: subtask.id,
      question: subtask.question,
      findings: `[executor error: subtask allows tools [${subtask.allowedTools.join(", ")}] but none are available]`,
      toolCalls: [],
      steps: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      terminationReason: "other",
      error: "no matching tools",
    };
  }

  const contextPreamble = subtask.dependsOn
    .map((depId) => {
      const finding = upstreamFindings.get(depId);
      return finding ? `[from ${depId}]: ${finding}` : null;
    })
    .filter((s): s is string => s !== null)
    .join("\n\n");

  const focusedQuestion =
    contextPreamble.length > 0
      ? `Context from earlier subtasks:\n${contextPreamble}\n\nYour subtask: ${subtask.question}`
      : subtask.question;

  try {
    const result = await runAgent(focusedQuestion, filteredTools, {
      systemPrompt: EXECUTOR_SYSTEM_PROMPT,
      maxSteps: MAX_EXECUTOR_STEPS,
    });
    return {
      subtaskId: subtask.id,
      question: subtask.question,
      findings: result.finalText,
      toolCalls: result.toolCalls,
      steps: result.steps,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheReadTokens: result.cacheReadTokens,
      cacheCreationTokens: result.cacheCreationTokens,
      terminationReason: result.terminationReason,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      subtaskId: subtask.id,
      question: subtask.question,
      findings: `[executor error: ${message}]`,
      toolCalls: [],
      steps: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      terminationReason: "other",
      error: message,
    };
  }
}
