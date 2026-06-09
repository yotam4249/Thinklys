import type { ToolCallTrace } from "../agent/types.js";

export interface Subtask {
  id: string;
  question: string;
  /**
   * Tool names this subtask is allowed to call. Must be a non-empty subset
   * of the available tool names — the orchestrator filters the AgentTool[]
   * down to this subset before invoking the executor.
   */
  allowedTools: string[];
  /** ids of subtasks whose findings must be available before this one runs. */
  dependsOn: string[];
}

export interface Plan {
  /** One- or two-sentence justification from the planner. */
  reasoning: string;
  subtasks: Subtask[];
}

export interface ExecutorResult {
  subtaskId: string;
  question: string;
  findings: string;
  toolCalls: ToolCallTrace[];
  steps: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  terminationReason: "end_turn" | "max_steps" | "stop_sequence" | "max_tokens" | "other";
  error?: string;
}

/**
 * Shaped to be drop-in compatible with `AgentRunResult` so the eval
 * harness can treat planner-executor as a third system without
 * special-casing the aggregator. `plan` + `executorResults` are the
 * extra fields specific to this system.
 */
export interface PlannerExecutorResult {
  finalText: string;
  steps: number;
  toolCalls: ToolCallTrace[];
  terminationReason: "end_turn" | "max_steps" | "stop_sequence" | "max_tokens" | "other";
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  plan: Plan;
  executorResults: ExecutorResult[];
}
