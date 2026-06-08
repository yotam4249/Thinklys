import { z } from "zod";
import type { DocumentSummary } from "../data/thinklysClient.js";
import { ThinklysApiError } from "../data/thinklysClient.js";
import { ToolError, type ToolContext } from "./types.js";

export const listDocumentsInputSchema = z.object({});

export type ListDocumentsInput = z.input<typeof listDocumentsInputSchema>;
export type ListDocumentsParsed = z.output<typeof listDocumentsInputSchema>;

export interface ListDocumentsOutput {
  documents: DocumentSummary[];
}

export const listDocumentsDescription =
  "Lists every document the authenticated user has uploaded — titles, document_ids, chunk counts. Call this when the user asks 'what documents do I have' or when you need a document_id to pass to the other tools.";

export const listDocumentsName = "list_documents";

export async function listDocuments(
  input: ListDocumentsInput,
  ctx: ToolContext,
): Promise<ListDocumentsOutput> {
  parseInput(input);
  try {
    const documents = await ctx.client.listDocuments();
    return { documents };
  } catch (err) {
    throw wrapClientError(err);
  }
}

function parseInput(input: unknown): ListDocumentsParsed {
  const result = listDocumentsInputSchema.safeParse(input);
  if (!result.success) {
    throw new ToolError(
      `list_documents: invalid input — ${result.error.message}`,
      "INVALID_INPUT",
    );
  }
  return result.data;
}

function wrapClientError(err: unknown): ToolError {
  if (err instanceof ThinklysApiError) {
    return new ToolError(
      `list_documents: upstream API error ${err.status} — ${err.message}`,
      "UPSTREAM_ERROR",
    );
  }
  if (err instanceof Error) {
    return new ToolError(`list_documents: ${err.message}`, "UNKNOWN_ERROR");
  }
  return new ToolError("list_documents: unknown error", "UNKNOWN_ERROR");
}
