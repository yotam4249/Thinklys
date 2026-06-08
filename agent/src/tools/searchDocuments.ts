import { z } from "zod";
import type { SearchResult } from "../data/thinklysClient.js";
import { ThinklysApiError } from "../data/thinklysClient.js";
import { ToolError, type ToolContext } from "./types.js";

export const searchDocumentsInputSchema = z.object({
  query: z.string().min(1).max(500),
  top_k: z.number().int().min(1).max(20).default(5),
});

export type SearchDocumentsInput = z.input<typeof searchDocumentsInputSchema>;
export type SearchDocumentsParsed = z.output<typeof searchDocumentsInputSchema>;

export interface SearchDocumentsOutput {
  results: SearchResult[];
}

export const searchDocumentsDescription =
  "Semantic search over the authenticated user's uploaded documents. Returns the most relevant chunks with their source document. Use this first when the user's question mentions a topic but no specific document.";

export const searchDocumentsName = "search_documents";

export async function searchDocuments(
  input: SearchDocumentsInput,
  ctx: ToolContext,
): Promise<SearchDocumentsOutput> {
  const parsed = parseInput(input);
  try {
    const results = await ctx.client.search(parsed.query, parsed.top_k);
    return { results };
  } catch (err) {
    throw wrapClientError(err);
  }
}

function parseInput(input: unknown): SearchDocumentsParsed {
  const result = searchDocumentsInputSchema.safeParse(input);
  if (!result.success) {
    throw new ToolError(
      `search_documents: invalid input — ${result.error.message}`,
      "INVALID_INPUT",
    );
  }
  return result.data;
}

function wrapClientError(err: unknown): ToolError {
  if (err instanceof ThinklysApiError) {
    return new ToolError(
      `search_documents: upstream API error ${err.status} — ${err.message}`,
      "UPSTREAM_ERROR",
    );
  }
  if (err instanceof Error) {
    return new ToolError(`search_documents: ${err.message}`, "UNKNOWN_ERROR");
  }
  return new ToolError("search_documents: unknown error", "UNKNOWN_ERROR");
}
