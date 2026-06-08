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
}

export interface AgentRunResult {
  finalText: string;
  steps: number;
  toolCalls: ToolCallTrace[];
  terminationReason: "end_turn" | "max_steps" | "stop_sequence" | "max_tokens" | "other";
  inputTokens: number;
  outputTokens: number;
}
