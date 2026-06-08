import type { z } from "zod";
import type { ToolContext } from "./types.js";
import {
  searchDocuments,
  searchDocumentsInputSchema,
  searchDocumentsDescription,
  searchDocumentsName,
  type SearchDocumentsInput,
  type SearchDocumentsOutput,
} from "./searchDocuments.js";
import {
  listDocuments,
  listDocumentsInputSchema,
  listDocumentsDescription,
  listDocumentsName,
  type ListDocumentsInput,
  type ListDocumentsOutput,
} from "./listDocuments.js";
import {
  getDocumentSection,
  getDocumentSectionInputSchema,
  getDocumentSectionDescription,
  getDocumentSectionName,
  type GetDocumentSectionInput,
  type GetDocumentSectionOutput,
} from "./getDocumentSection.js";
import {
  summarizeDocument,
  summarizeDocumentInputSchema,
  summarizeDocumentDescription,
  summarizeDocumentName,
  type SummarizeDocumentInput,
  type SummarizeDocumentOutput,
} from "./summarizeDocument.js";

export { ToolError } from "./types.js";
export type { ToolContext } from "./types.js";

export {
  searchDocuments,
  searchDocumentsInputSchema,
  searchDocumentsDescription,
  searchDocumentsName,
  listDocuments,
  listDocumentsInputSchema,
  listDocumentsDescription,
  listDocumentsName,
  getDocumentSection,
  getDocumentSectionInputSchema,
  getDocumentSectionDescription,
  getDocumentSectionName,
  summarizeDocument,
  summarizeDocumentInputSchema,
  summarizeDocumentDescription,
  summarizeDocumentName,
};

export type {
  SearchDocumentsInput,
  SearchDocumentsOutput,
  ListDocumentsInput,
  ListDocumentsOutput,
  GetDocumentSectionInput,
  GetDocumentSectionOutput,
  SummarizeDocumentInput,
  SummarizeDocumentOutput,
};

export interface ToolSpec<I, O> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  run: (input: I, ctx: ToolContext) => Promise<O>;
}

export const searchDocumentsTool: ToolSpec<SearchDocumentsInput, SearchDocumentsOutput> = {
  name: searchDocumentsName,
  description: searchDocumentsDescription,
  inputSchema: searchDocumentsInputSchema as unknown as z.ZodType<SearchDocumentsInput>,
  run: searchDocuments,
};

export const listDocumentsTool: ToolSpec<ListDocumentsInput, ListDocumentsOutput> = {
  name: listDocumentsName,
  description: listDocumentsDescription,
  inputSchema: listDocumentsInputSchema as unknown as z.ZodType<ListDocumentsInput>,
  run: listDocuments,
};

export const getDocumentSectionTool: ToolSpec<
  GetDocumentSectionInput,
  GetDocumentSectionOutput
> = {
  name: getDocumentSectionName,
  description: getDocumentSectionDescription,
  inputSchema: getDocumentSectionInputSchema as unknown as z.ZodType<GetDocumentSectionInput>,
  run: getDocumentSection,
};

export const summarizeDocumentTool: ToolSpec<
  SummarizeDocumentInput,
  SummarizeDocumentOutput
> = {
  name: summarizeDocumentName,
  description: summarizeDocumentDescription,
  inputSchema: summarizeDocumentInputSchema as unknown as z.ZodType<SummarizeDocumentInput>,
  run: summarizeDocument,
};

export const ALL_TOOLS: ReadonlyArray<ToolSpec<unknown, unknown>> = [
  searchDocumentsTool as unknown as ToolSpec<unknown, unknown>,
  listDocumentsTool as unknown as ToolSpec<unknown, unknown>,
  getDocumentSectionTool as unknown as ToolSpec<unknown, unknown>,
  summarizeDocumentTool as unknown as ToolSpec<unknown, unknown>,
];
