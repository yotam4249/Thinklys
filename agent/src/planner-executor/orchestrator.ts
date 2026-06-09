import Anthropic from "@anthropic-ai/sdk";
import type { AgentTool, ToolCallTrace } from "../agent/types.js";
import { planQuestion } from "./planner.js";
import { runExecutor } from "./executor.js";
import { synthesize } from "./synthesizer.js";
import type {
  ExecutorResult,
  PlannerExecutorResult,
  Subtask,
} from "./types.js";

/**
 * Group subtasks into dependency levels via Kahn's algorithm. Within a level,
 * subtasks have no dependencies on each other and can run in parallel.
 */
function topologicalLevels(subtasks: ReadonlyArray<Subtask>): Subtask[][] {
  const remaining = new Map<string, Subtask>();
  for (const st of subtasks) remaining.set(st.id, st);

  const levels: Subtask[][] = [];
  const settled = new Set<string>();
  while (remaining.size > 0) {
    const ready: Subtask[] = [];
    for (const st of remaining.values()) {
      if (st.dependsOn.every((d) => settled.has(d))) ready.push(st);
    }
    if (ready.length === 0) {
      throw new Error(
        `orchestrator: cyclic / unsatisfiable dependencies in subtasks: ${[
          ...remaining.keys(),
        ].join(", ")}`,
      );
    }
    levels.push(ready);
    for (const st of ready) {
      remaining.delete(st.id);
      settled.add(st.id);
    }
  }
  return levels;
}

function flattenToolCalls(results: ReadonlyArray<ExecutorResult>): ToolCallTrace[] {
  const out: ToolCallTrace[] = [];
  for (const r of results) {
    for (const tc of r.toolCalls) {
      out.push({ ...tc, tool: `${r.subtaskId}/${tc.tool}` });
    }
  }
  return out;
}

export interface RunPlannerExecutorOptions {
  /** Reuse an Anthropic client (e.g. when the eval harness owns it). */
  anthropic?: Anthropic;
}

export async function runPlannerExecutor(
  question: string,
  tools: ReadonlyArray<AgentTool>,
  options?: RunPlannerExecutorOptions,
): Promise<PlannerExecutorResult> {
  const anthropic = options?.anthropic ?? new Anthropic();

  // 1. PLAN
  const planResp = await planQuestion(question, tools, anthropic);
  const { plan } = planResp;

  // 2. EXECUTE — level by level, parallel within a level.
  const levels = topologicalLevels(plan.subtasks);
  const executorResults: ExecutorResult[] = [];
  const findingsById = new Map<string, string>();
  for (const level of levels) {
    const settled = await Promise.all(
      level.map((st) => runExecutor(st, tools, findingsById)),
    );
    for (const r of settled) {
      executorResults.push(r);
      findingsById.set(r.subtaskId, r.findings);
    }
  }

  // 3. SYNTHESIZE
  const synthResp = await synthesize(question, executorResults, anthropic);

  // Aggregate accounting. `steps` = planner(1) + sum(executor steps) + synth(1).
  let inputTokens = planResp.inputTokens + synthResp.inputTokens;
  let outputTokens = planResp.outputTokens + synthResp.outputTokens;
  let cacheReadTokens = planResp.cacheReadTokens + synthResp.cacheReadTokens;
  let cacheCreationTokens = planResp.cacheCreationTokens + synthResp.cacheCreationTokens;
  let totalSteps = 2;
  let anyExecutorError = false;
  for (const r of executorResults) {
    inputTokens += r.inputTokens;
    outputTokens += r.outputTokens;
    cacheReadTokens += r.cacheReadTokens;
    cacheCreationTokens += r.cacheCreationTokens;
    totalSteps += r.steps;
    if (r.error !== undefined) anyExecutorError = true;
  }

  return {
    finalText: synthResp.finalText,
    steps: totalSteps,
    toolCalls: flattenToolCalls(executorResults),
    terminationReason: anyExecutorError ? "other" : "end_turn",
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    plan,
    executorResults,
  };
}
