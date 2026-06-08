import { z } from "zod";

export interface AgentTool<I = unknown, O = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  run: (input: I) => Promise<O>;
}

export interface ToolCallTrace {
  step: number;
  tool: string;
  input: unknown;
  output: unknown;
  error?: string;
  latencyMs: number;
  // Phase 6: per-step Anthropic prompt-caching telemetry. Reported on the
  // Claude response that *requested* this tool call. Optional because some
  // call sites may not have produced them (e.g. mock tests).
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export interface AgentRunResult {
  finalText: string;
  steps: number;
  toolCalls: ToolCallTrace[];
  terminationReason: "end_turn" | "max_steps" | "stop_sequence" | "max_tokens" | "other";
  inputTokens: number;
  outputTokens: number;
  // Phase 6: prompt-caching token accounting across the whole run.
  cacheReadTokens: number;
  cacheCreationTokens: number;
}
