import type { z } from "zod";
import {
  searchDocumentsInputSchema,
  searchDocumentsDescription,
  searchDocumentsName,
  listDocumentsInputSchema,
  listDocumentsDescription,
  listDocumentsName,
  getDocumentSectionInputSchema,
  getDocumentSectionDescription,
  getDocumentSectionName,
  summarizeDocumentInputSchema,
  summarizeDocumentDescription,
  summarizeDocumentName,
  type SearchDocumentsInput,
  type SearchDocumentsOutput,
  type ListDocumentsInput,
  type ListDocumentsOutput,
  type GetDocumentSectionInput,
  type GetDocumentSectionOutput,
  type SummarizeDocumentInput,
  type SummarizeDocumentOutput,
} from "../tools/index.js";
import type { AgentTool } from "./types.js";

const DEMO_DOCUMENT_ID = "demo/notes.pdf";

export const mockListDocuments: AgentTool<
  ListDocumentsInput,
  ListDocumentsOutput
> = {
  name: listDocumentsName,
  description: listDocumentsDescription,
  inputSchema: listDocumentsInputSchema as unknown as z.ZodType<ListDocumentsInput>,
  run: async (_input) => {
    return {
      documents: [
        {
          document_id: DEMO_DOCUMENT_ID,
          title: "notes",
          chunk_count: 12,
          topic: "demo",
          level: "intermediate",
        },
      ],
    };
  },
};

export const mockSearchDocuments: AgentTool<
  SearchDocumentsInput,
  SearchDocumentsOutput
> = {
  name: searchDocumentsName,
  description: searchDocumentsDescription,
  inputSchema: searchDocumentsInputSchema as unknown as z.ZodType<SearchDocumentsInput>,
  run: async (input) => {
    const query = input.query;
    return {
      results: [
        {
          chunk_id: "demo/notes.pdf::chunk-3",
          document_id: DEMO_DOCUMENT_ID,
          text: `[MOCK] Top match for "${query}": transformers use self-attention to weight tokens.`,
          score: 0.83,
          chunk_index: 3,
        },
        {
          chunk_id: "demo/notes.pdf::chunk-5",
          document_id: DEMO_DOCUMENT_ID,
          text: `[MOCK] Secondary match for "${query}": positional encodings inject order into transformer inputs.`,
          score: 0.71,
          chunk_index: 5,
        },
      ],
    };
  },
};

export const mockGetDocumentSection: AgentTool<
  GetDocumentSectionInput,
  GetDocumentSectionOutput
> = {
  name: getDocumentSectionName,
  description: getDocumentSectionDescription,
  inputSchema: getDocumentSectionInputSchema as unknown as z.ZodType<GetDocumentSectionInput>,
  run: async (input) => {
    const documentId = input.document_id;
    return {
      results: [
        {
          chunk_id: `${documentId}::chunk-3`,
          document_id: documentId,
          text: "[MOCK] Section text: transformers consist of encoder/decoder stacks of attention + MLP blocks.",
          score: null,
          chunk_index: 3,
        },
      ],
    };
  },
};

export const mockSummarizeDocument: AgentTool<
  SummarizeDocumentInput,
  SummarizeDocumentOutput
> = {
  name: summarizeDocumentName,
  description: summarizeDocumentDescription,
  inputSchema: summarizeDocumentInputSchema as unknown as z.ZodType<SummarizeDocumentInput>,
  run: async (input) => {
    const documentId = input.document_id;
    const chunks = [
      {
        chunk_id: `${documentId}::chunk-0`,
        text: "[MOCK] chunk1: intro to transformers and the attention mechanism.",
        chunk_index: 0,
      },
      {
        chunk_id: `${documentId}::chunk-1`,
        text: "[MOCK] chunk2: encoder and decoder block structure, residual connections.",
        chunk_index: 1,
      },
      {
        chunk_id: `${documentId}::chunk-2`,
        text: "[MOCK] chunk3: training objectives and downstream fine-tuning.",
        chunk_index: 2,
      },
    ];
    return {
      document_id: documentId,
      chunks,
      concatenated_text: "[MOCK] chunk1\n\nchunk2\n\nchunk3",
    };
  },
};

export const mockTools: ReadonlyArray<AgentTool> = [
  mockListDocuments as unknown as AgentTool,
  mockSearchDocuments as unknown as AgentTool,
  mockGetDocumentSection as unknown as AgentTool,
  mockSummarizeDocument as unknown as AgentTool,
];
