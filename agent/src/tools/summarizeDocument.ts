import { z } from "zod";
import type { Chunk } from "../data/thinklysClient.js";
import { ThinklysApiError } from "../data/thinklysClient.js";
import { ToolError, type ToolContext } from "./types.js";

const CONCATENATED_TEXT_CAP = 12000;
const TRUNCATION_MARKER = "\n\n…[truncated]";

export const summarizeDocumentInputSchema = z.object({
  document_id: z.string().min(1).max(500),
  max_chunks: z.number().int().min(1).max(200).default(50),
});

export type SummarizeDocumentInput = z.input<typeof summarizeDocumentInputSchema>;
export type SummarizeDocumentParsed = z.output<typeof summarizeDocumentInputSchema>;

export interface SummarizeDocumentOutput {
  document_id: string;
  chunks: Chunk[];
  concatenated_text: string;
}

export const summarizeDocumentDescription =
  "Returns the full text of a single document as ordered chunks, suitable for the model to summarize. Use this AFTER you've identified the right document. The model writes the summary; this tool only fetches the grounded source material.";

export const summarizeDocumentName = "summarize_document";

export async function summarizeDocument(
  input: SummarizeDocumentInput,
  ctx: ToolContext,
): Promise<SummarizeDocumentOutput> {
  const parsed = parseInput(input);
  try {
    const data = await ctx.client.getChunks(parsed.document_id, parsed.max_chunks);
    const limited = data.chunks.slice(0, parsed.max_chunks);
    const joined = limited.map((c) => c.text).join("\n\n");
    const concatenated_text =
      joined.length > CONCATENATED_TEXT_CAP
        ? joined.slice(0, CONCATENATED_TEXT_CAP) + TRUNCATION_MARKER
        : joined;
    return {
      document_id: data.document_id,
      chunks: limited,
      concatenated_text,
    };
  } catch (err) {
    throw wrapClientError(err);
  }
}

function parseInput(input: unknown): SummarizeDocumentParsed {
  const result = summarizeDocumentInputSchema.safeParse(input);
  if (!result.success) {
    throw new ToolError(
      `summarize_document: invalid input — ${result.error.message}`,
      "INVALID_INPUT",
    );
  }
  return result.data;
}

function wrapClientError(err: unknown): ToolError {
  if (err instanceof ThinklysApiError) {
    return new ToolError(
      `summarize_document: upstream API error ${err.status} — ${err.message}`,
      "UPSTREAM_ERROR",
    );
  }
  if (err instanceof Error) {
    return new ToolError(`summarize_document: ${err.message}`, "UNKNOWN_ERROR");
  }
  return new ToolError("summarize_document: unknown error", "UNKNOWN_ERROR");
}
