import Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import type {
  AgentRunResult,
  AgentTool,
  ToolCallTrace,
} from "./types.js";

// Default model for the agent. Override via options.model.
const DEFAULT_MODEL = "claude-opus-4-7";
const DEFAULT_MAX_STEPS = 10;
const DEFAULT_MAX_TOKENS = 1024;

const DEFAULT_SYSTEM_PROMPT = [
  "You are a research agent for a learning platform.",
  "The user asks questions about their own uploaded documents.",
  "You have tools to search and read those documents.",
  "Use tools when the answer is not already in the conversation. Cite which document each fact came from.",
  "Refuse to answer when the documents do not support it.",
].join(" ");

export interface RunAgentOptions {
  systemPrompt?: string;
  model?: string;
  maxSteps?: number;
  maxTokens?: number;
}

interface ToolUseBlockShape {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

interface TextBlockShape {
  type: "text";
  text: string;
}

type ContentBlock =
  | TextBlockShape
  | ToolUseBlockShape
  | { type: string; [k: string]: unknown };

function buildToolDefinitions(
  tools: ReadonlyArray<AgentTool>,
): Anthropic.Messages.Tool[] {
  const built = tools.map((tool) => {
    const jsonSchema = zodToJsonSchema(tool.inputSchema, {
      $refStrategy: "none",
      target: "openApi3",
    }) as Record<string, unknown>;

    // Anthropic expects an object schema with `type: "object"` and `properties`.
    // Empty-object zod schemas can emit something without `properties`; ensure shape.
    const rawProps = jsonSchema["properties"];
    const properties: Record<string, unknown> =
      rawProps && typeof rawProps === "object"
        ? (rawProps as Record<string, unknown>)
        : {};
    const rawRequired = jsonSchema["required"];
    const required: string[] | undefined = Array.isArray(rawRequired)
      ? (rawRequired as string[])
      : undefined;

    const input_schema = {
      type: "object" as const,
      properties,
      ...(required && required.length > 0 ? { required } : {}),
    };

    return {
      name: tool.name,
      description: tool.description,
      input_schema,
    } satisfies Anthropic.Messages.Tool;
  });

  // Phase 6 — prompt caching for tools.
  // Per Anthropic's docs, attaching `cache_control` to the LAST tool in the
  // array caches the entire `tools` block. Tool definitions are stable for
  // the whole run, so this is a free hit on every turn after the first.
  if (built.length > 0) {
    const last = built[built.length - 1] as Anthropic.Messages.Tool & {
      cache_control?: { type: "ephemeral" };
    };
    last.cache_control = { type: "ephemeral" };
  }
  return built;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function mapStopReason(
  reason: string | null,
): AgentRunResult["terminationReason"] {
  switch (reason) {
    case "end_turn":
      return "end_turn";
    case "stop_sequence":
      return "stop_sequence";
    case "max_tokens":
      return "max_tokens";
    default:
      return "other";
  }
}

function extractFinalText(blocks: ReadonlyArray<ContentBlock>): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === "text") {
      parts.push((block as TextBlockShape).text);
    }
  }
  return parts.join("\n").trim();
}

interface AnthropicUsageWithCache {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

function readCacheTokens(usage: AnthropicUsageWithCache): {
  cacheReadTokens: number;
  cacheCreationTokens: number;
} {
  const cacheReadTokens =
    typeof usage.cache_read_input_tokens === "number"
      ? usage.cache_read_input_tokens
      : 0;
  const cacheCreationTokens =
    typeof usage.cache_creation_input_tokens === "number"
      ? usage.cache_creation_input_tokens
      : 0;
  return { cacheReadTokens, cacheCreationTokens };
}

export async function runAgent(
  question: string,
  tools: ReadonlyArray<AgentTool>,
  options?: RunAgentOptions,
): Promise<AgentRunResult> {
  const model = options?.model ?? DEFAULT_MODEL;
  const maxSteps = options?.maxSteps ?? DEFAULT_MAX_STEPS;
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const systemPrompt = options?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

  const toolsByName = new Map<string, AgentTool>();
  for (const t of tools) {
    toolsByName.set(t.name, t);
  }

  const toolDefinitions = buildToolDefinitions(tools);
  const client = new Anthropic();

  // Phase 6 — prompt caching for the system prompt. We switch from a plain
  // string to a content-block array so we can mark the last block with
  // `cache_control: ephemeral`. The system prompt is stable across the
  // whole run, so we pay creation cost once and read on every later turn.
  const systemBlocks: Anthropic.Messages.TextBlockParam[] = [
    {
      type: "text",
      text: systemPrompt,
      cache_control: { type: "ephemeral" },
    },
  ];

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: question },
  ];

  const toolCalls: ToolCallTrace[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokensTotal = 0;
  let cacheCreationTokensTotal = 0;
  let lastText = "";
  let stepsTaken = 0;

  // NOTE: streaming would be a future improvement; using non-streaming
  // messages.create for simplicity and easier loop semantics.
  for (let step = 1; step <= maxSteps; step += 1) {
    stepsTaken = step;

    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemBlocks,
      tools: toolDefinitions,
      messages,
    });

    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;
    const { cacheReadTokens, cacheCreationTokens } = readCacheTokens(
      response.usage as unknown as AnthropicUsageWithCache,
    );
    cacheReadTokensTotal += cacheReadTokens;
    cacheCreationTokensTotal += cacheCreationTokens;

    const responseContent = response.content as unknown as ContentBlock[];
    const textInThisTurn = extractFinalText(responseContent);
    if (textInThisTurn) {
      lastText = textInThisTurn;
    }

    if (response.stop_reason !== "tool_use") {
      return {
        finalText: lastText,
        steps: step,
        toolCalls,
        terminationReason: mapStopReason(response.stop_reason),
        inputTokens,
        outputTokens,
        cacheReadTokens: cacheReadTokensTotal,
        cacheCreationTokens: cacheCreationTokensTotal,
      };
    }

    // Append the assistant message (full content array — required so that
    // tool_use_id ↔ tool_result linkage is preserved). The SDK's output
    // blocks are structurally compatible as input blocks; cast through unknown.
    messages.push({
      role: "assistant",
      content: response.content as unknown as Anthropic.Messages.ContentBlockParam[],
    });

    // Execute every tool_use block in order, collect tool_result blocks.
    const toolResultBlocks: Anthropic.Messages.ToolResultBlockParam[] = [];

    for (const block of responseContent) {
      if (block.type !== "tool_use") continue;
      const useBlock = block as ToolUseBlockShape;
      const tool = toolsByName.get(useBlock.name);
      const started = Date.now();

      if (!tool) {
        const errMsg = `Unknown tool: ${useBlock.name}`;
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: useBlock.id,
          content: errMsg,
          is_error: true,
        });
        toolCalls.push({
          step,
          tool: useBlock.name,
          input: useBlock.input,
          output: null,
          error: errMsg,
          latencyMs: Date.now() - started,
          cacheReadTokens,
          cacheCreationTokens,
        });
        continue;
      }

      const parseResult = tool.inputSchema.safeParse(useBlock.input);
      if (!parseResult.success) {
        const errMsg = `Invalid input for ${tool.name}: ${parseResult.error.message}`;
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: useBlock.id,
          content: errMsg,
          is_error: true,
        });
        toolCalls.push({
          step,
          tool: tool.name,
          input: useBlock.input,
          output: null,
          error: errMsg,
          latencyMs: Date.now() - started,
          cacheReadTokens,
          cacheCreationTokens,
        });
        continue;
      }

      try {
        const output: unknown = await tool.run(parseResult.data);
        const serialized = safeStringify(output);
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: useBlock.id,
          content: serialized,
        });
        toolCalls.push({
          step,
          tool: tool.name,
          input: parseResult.data,
          output,
          latencyMs: Date.now() - started,
          cacheReadTokens,
          cacheCreationTokens,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : safeStringify(err);
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: useBlock.id,
          content: `Tool ${tool.name} failed: ${message}`,
          is_error: true,
        });
        toolCalls.push({
          step,
          tool: tool.name,
          input: parseResult.data,
          output: null,
          error: message,
          latencyMs: Date.now() - started,
          cacheReadTokens,
          cacheCreationTokens,
        });
      }
    }

    messages.push({
      role: "user",
      content: toolResultBlocks as Anthropic.Messages.ContentBlockParam[],
    });
  }

  // Max steps exceeded — return whatever text we last saw.
  return {
    finalText:
      lastText ||
      `[agent terminated: hit maxSteps=${maxSteps} without an end_turn]`,
    steps: stepsTaken,
    toolCalls,
    terminationReason: "max_steps",
    inputTokens,
    outputTokens,
    cacheReadTokens: cacheReadTokensTotal,
    cacheCreationTokens: cacheCreationTokensTotal,
  };
}
