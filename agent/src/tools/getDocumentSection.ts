import { z } from "zod";
import { ThinklysApiError } from "../data/thinklysClient.js";
import { ToolError, type ToolContext } from "./types.js";

export const getDocumentSectionInputSchema = z.object({
  document_id: z.string().min(1).max(500),
  query: z.string().min(1).max(500).optional(),
  top_k: z.number().int().min(1).max(10).default(3),
});

export type GetDocumentSectionInput = z.input<typeof getDocumentSectionInputSchema>;
export type GetDocumentSectionParsed = z.output<typeof getDocumentSectionInputSchema>;

export interface SectionResult {
  chunk_id: string;
  document_id: string;
  text: string;
  score: number | null;
  chunk_index?: number | null | undefined;
}

export interface GetDocumentSectionOutput {
  results: SectionResult[];
}

export const getDocumentSectionDescription =
  "Retrieves a passage from a SPECIFIC document. Provide `document_id` and an optional `query` to focus on a passage. Use this when the user names a document or you've narrowed the answer to one document.";

export const getDocumentSectionName = "get_document_section";

export async function getDocumentSection(
  input: GetDocumentSectionInput,
  ctx: ToolContext,
): Promise<GetDocumentSectionOutput> {
  const parsed = parseInput(input);
  try {
    if (parsed.query !== undefined) {
      const results = await ctx.client.getSection(
        parsed.document_id,
        parsed.query,
        parsed.top_k,
      );
      const projected: SectionResult[] = results.map((r) => ({
        chunk_id: r.chunk_id,
        document_id: r.document_id,
        text: r.text,
        score: r.score,
        ...(r.chunk_index !== undefined ? { chunk_index: r.chunk_index } : {}),
      }));
      return { results: projected };
    }

    const chunks = await ctx.client.getChunks(parsed.document_id, parsed.top_k);
    const projected: SectionResult[] = chunks.chunks.slice(0, parsed.top_k).map((c) => ({
      chunk_id: c.chunk_id,
      document_id: chunks.document_id,
      text: c.text,
      score: null,
      ...(c.chunk_index !== undefined ? { chunk_index: c.chunk_index } : {}),
    }));
    return { results: projected };
  } catch (err) {
    throw wrapClientError(err);
  }
}

function parseInput(input: unknown): GetDocumentSectionParsed {
  const result = getDocumentSectionInputSchema.safeParse(input);
  if (!result.success) {
    throw new ToolError(
      `get_document_section: invalid input — ${result.error.message}`,
      "INVALID_INPUT",
    );
  }
  return result.data;
}

function wrapClientError(err: unknown): ToolError {
  if (err instanceof ThinklysApiError) {
    return new ToolError(
      `get_document_section: upstream API error ${err.status} — ${err.message}`,
      "UPSTREAM_ERROR",
    );
  }
  if (err instanceof Error) {
    return new ToolError(`get_document_section: ${err.message}`, "UNKNOWN_ERROR");
  }
  return new ToolError("get_document_section: unknown error", "UNKNOWN_ERROR");
}
