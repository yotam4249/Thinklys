import Anthropic from "@anthropic-ai/sdk";
import { ThinklysClient, type SearchResult } from "../data/thinklysClient.js";
import { costFor } from "../observability/pricing.js";
import type { SystemRun } from "./types.js";

export const BASELINE_MODEL = "claude-opus-4-7";
const DEFAULT_TOP_K = 5;
const DEFAULT_MAX_TOKENS = 1024;

const BASELINE_SYSTEM_PROMPT =
  "Answer the question using only the provided context. Cite each source by document_id. If the context does not contain the answer, say so.";

export interface BaselineOptions {
  model?: string;
  topK?: number;
  maxTokens?: number;
}

function formatChunks(results: ReadonlyArray<SearchResult>): string {
  if (results.length === 0) return "(no chunks returned)";
  return results
    .map((r, i) => {
      const idx = i + 1;
      return `[#${idx} document_id=${r.document_id} chunk_id=${r.chunk_id}]\n${r.text}`;
    })
    .join("\n\n");
}

interface UsageWithCache {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

function readCache(usage: UsageWithCache): {
  cacheReadTokens: number;
  cacheCreationTokens: number;
} {
  return {
    cacheReadTokens:
      typeof usage.cache_read_input_tokens === "number"
        ? usage.cache_read_input_tokens
        : 0,
    cacheCreationTokens:
      typeof usage.cache_creation_input_tokens === "number"
        ? usage.cache_creation_input_tokens
        : 0,
  };
}

function extractText(content: ReadonlyArray<Anthropic.Messages.ContentBlock>): string {
  const out: string[] = [];
  for (const block of content) {
    if (block.type === "text") out.push(block.text);
  }
  return out.join("\n").trim();
}

/**
 * Plain top-k RAG: one `search_documents` call, stuff into one Claude call.
 *
 * The tool count is reported as 1 (the search) so the table is fair: the
 * baseline does retrieve, it just doesn't iterate or reason about which
 * tool to call.
 */
export async function runBaseline(
  caseId: string,
  question: string,
  client: ThinklysClient,
  anthropic: Anthropic,
  options?: BaselineOptions,
): Promise<SystemRun> {
  const model = options?.model ?? BASELINE_MODEL;
  const topK = options?.topK ?? DEFAULT_TOP_K;
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const started = Date.now();

  const searchResults = await client.search(question, topK);
  const contextStr = formatChunks(searchResults);

  const userMessage = `Context:\n${contextStr}\n\nQuestion: ${question}`;

  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system: BASELINE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const finalText = extractText(response.content);
  const { cacheReadTokens, cacheCreationTokens } = readCache(
    response.usage as unknown as UsageWithCache,
  );
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const latencyMs = Date.now() - started;
  const costUsd = costFor(
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
  );

  return {
    system: "baseline",
    caseId,
    finalText,
    toolCalls: 1,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    latencyMs,
    costUsd,
    contextSentToJudge: contextStr,
  };
}
