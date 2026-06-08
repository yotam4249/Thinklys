import { z } from "zod";

const DocumentSummarySchema = z.object({
  document_id: z.string(),
  title: z.string(),
  chunk_count: z.number().int().nonnegative(),
  topic: z.string().nullable().optional(),
  level: z.string().nullable().optional(),
});

const DocumentsResponseSchema = z.object({
  documents: z.array(DocumentSummarySchema),
});

const SearchResultSchema = z.object({
  chunk_id: z.string(),
  document_id: z.string(),
  text: z.string(),
  score: z.number(),
  chunk_index: z.number().int().nullable().optional(),
});

const SearchResponseSchema = z.object({
  results: z.array(SearchResultSchema),
});

const ChunkSchema = z.object({
  chunk_id: z.string(),
  text: z.string(),
  chunk_index: z.number().int().nullable().optional(),
});

const ChunksResponseSchema = z.object({
  document_id: z.string(),
  chunks: z.array(ChunkSchema),
});

export type DocumentSummary = z.infer<typeof DocumentSummarySchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type Chunk = z.infer<typeof ChunkSchema>;
export type ChunksResponse = z.infer<typeof ChunksResponseSchema>;

export class ThinklysApiError extends Error {
  public readonly status: number;
  public readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ThinklysApiError";
    this.status = status;
    this.body = body;
  }
}

export interface ThinklysClientOptions {
  baseUrl?: string;
  jwt?: string;
  fetchImpl?: typeof fetch;
}

export class ThinklysClient {
  private readonly baseUrl: string;
  private readonly jwt: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ThinklysClientOptions = {}) {
    const baseUrl = options.baseUrl ?? process.env["THINKLYS_API_BASE"];
    const jwt = options.jwt ?? process.env["THINKLYS_JWT"];

    if (!baseUrl || baseUrl.trim() === "") {
      throw new Error(
        "ThinklysClient: THINKLYS_API_BASE is required (set env var or pass baseUrl).",
      );
    }
    if (!jwt || jwt.trim() === "") {
      throw new Error(
        "ThinklysClient: THINKLYS_JWT is required (set env var or pass jwt).",
      );
    }

    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.jwt = jwt;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.jwt}`,
      Accept: "application/json",
      ...(init.headers as Record<string, string> | undefined),
    };
    if (init.body !== undefined && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    const response = await this.fetchImpl(url, { ...init, headers });
    const rawBody = await response.text();
    let parsedBody: unknown = rawBody;
    if (rawBody.length > 0) {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        parsedBody = rawBody;
      }
    }

    if (!response.ok) {
      throw new ThinklysApiError(
        `Thinklys API ${response.status} ${response.statusText} for ${init.method ?? "GET"} ${path}`,
        response.status,
        parsedBody,
      );
    }

    const parseResult = schema.safeParse(parsedBody);
    if (!parseResult.success) {
      throw new ThinklysApiError(
        `Thinklys API response failed schema validation for ${path}: ${parseResult.error.message}`,
        response.status,
        parsedBody,
      );
    }
    return parseResult.data;
  }

  private encodeDocumentId(documentId: string): string {
    // S3 keys contain '/'; keep them so FastAPI's path converter receives
    // them intact, but encode every other special character.
    return documentId
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
  }

  async listDocuments(): Promise<DocumentSummary[]> {
    const data = await this.request(
      "/api/agent/documents",
      { method: "GET" },
      DocumentsResponseSchema,
    );
    return data.documents;
  }

  async search(query: string, topK?: number): Promise<SearchResult[]> {
    const body: Record<string, unknown> = { query };
    if (topK !== undefined) body["top_k"] = topK;
    const data = await this.request(
      "/api/agent/search",
      { method: "POST", body: JSON.stringify(body) },
      SearchResponseSchema,
    );
    return data.results;
  }

  async getSection(
    documentId: string,
    query: string,
    topK?: number,
  ): Promise<SearchResult[]> {
    const params = new URLSearchParams({ query });
    if (topK !== undefined) params.set("top_k", String(topK));
    const path = `/api/agent/documents/${this.encodeDocumentId(documentId)}/section?${params.toString()}`;
    const data = await this.request(path, { method: "GET" }, SearchResponseSchema);
    return data.results;
  }

  async getChunks(
    documentId: string,
    limit?: number,
  ): Promise<ChunksResponse> {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set("limit", String(limit));
    const qs = params.toString();
    const suffix = qs.length > 0 ? `?${qs}` : "";
    const path = `/api/agent/documents/${this.encodeDocumentId(documentId)}/chunks${suffix}`;
    return this.request(path, { method: "GET" }, ChunksResponseSchema);
  }
}
