import Anthropic from "@anthropic-ai/sdk";
import type { ExecutorResult } from "./types.js";

const SYNTHESIZER_MODEL = "claude-opus-4-7";
const SYNTHESIZER_MAX_TOKENS = 1024;

const SYNTHESIZER_SYSTEM_PROMPT = [
  "You are the SYNTHESIZER in a multi-agent retrieval system.",
  "Several executors have each addressed one subtask of the user's question.",
  "Combine their findings into a single grounded answer to the user's ORIGINAL question.",
  "Cite document_id for every factual claim.",
  "If any subtask failed or returned no information, acknowledge that limitation rather than papering over it.",
].join(" ");

function formatExecutorResults(results: ReadonlyArray<ExecutorResult>): string {
  if (results.length === 0) return "(no executor results)";
  return results
    .map((r) => {
      const head = `### Subtask ${r.subtaskId}: ${r.question}`;
      const tail = r.error
        ? `(executor error: ${r.error})`
        : r.findings;
      return `${head}\n${tail}`;
    })
    .join("\n\n");
}

function extractText(content: ReadonlyArray<Anthropic.Messages.ContentBlock>): string {
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text") parts.push(block.text);
  }
  return parts.join("\n").trim();
}

export async function synthesize(
  originalQuestion: string,
  executorResults: ReadonlyArray<ExecutorResult>,
  anthropic: Anthropic,
): Promise<{
  finalText: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}> {
  const userMessage =
    `Original question: ${originalQuestion}\n\n` +
    `Executor findings:\n${formatExecutorResults(executorResults)}`;

  const response = await anthropic.messages.create({
    model: SYNTHESIZER_MODEL,
    max_tokens: SYNTHESIZER_MAX_TOKENS,
    system: SYNTHESIZER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const usage = response.usage as unknown as {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };

  return {
    finalText: extractText(response.content),
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : 0,
    cacheCreationTokens:
      typeof usage.cache_creation_input_tokens === "number"
        ? usage.cache_creation_input_tokens
        : 0,
  };
}
