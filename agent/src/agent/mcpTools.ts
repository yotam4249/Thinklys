import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { z } from "zod";
import {
  searchDocumentsInputSchema,
  searchDocumentsName,
  listDocumentsInputSchema,
  listDocumentsName,
  getDocumentSectionInputSchema,
  getDocumentSectionName,
  summarizeDocumentInputSchema,
  summarizeDocumentName,
} from "../tools/index.js";
import type { AgentTool } from "./types.js";

// Map MCP tool names back to the original zod input schemas defined in
// `src/tools/*`. We re-use these for defense-in-depth: even though the MCP
// server publishes a JSON Schema, validating locally with zod keeps
// `AgentTool.inputSchema` typed as `z.ZodType<unknown>` (which `loop.ts`
// wants) and catches malformed model output before it crosses the stdio
// boundary.
const LOCAL_SCHEMAS: Record<string, z.ZodType<unknown>> = {
  [searchDocumentsName]: searchDocumentsInputSchema as unknown as z.ZodType<unknown>,
  [listDocumentsName]: listDocumentsInputSchema as unknown as z.ZodType<unknown>,
  [getDocumentSectionName]: getDocumentSectionInputSchema as unknown as z.ZodType<unknown>,
  [summarizeDocumentName]: summarizeDocumentInputSchema as unknown as z.ZodType<unknown>,
};

interface McpTextBlock {
  type: "text";
  text: string;
}

interface McpContentBlock {
  type: string;
  text?: string;
  [k: string]: unknown;
}

interface McpCallToolResult {
  content?: McpContentBlock[];
  isError?: boolean;
}

function isTextBlock(block: McpContentBlock): block is McpTextBlock {
  return block.type === "text" && typeof block.text === "string";
}

function parseTextBlock(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractPayload(result: McpCallToolResult): unknown {
  const blocks = result.content ?? [];
  const texts = blocks.filter(isTextBlock).map((b) => b.text);

  if (texts.length === 0) {
    return null;
  }
  if (texts.length === 1) {
    return parseTextBlock(texts[0]);
  }
  return texts.map(parseTextBlock);
}

function concatenatedErrorText(result: McpCallToolResult): string {
  const blocks = result.content ?? [];
  const texts = blocks.filter(isTextBlock).map((b) => b.text);
  if (texts.length === 0) {
    return "(no error text returned by tool)";
  }
  return texts.join("\n");
}

export interface McpToolsHandle {
  tools: AgentTool[];
  close: () => Promise<void>;
}

export async function connectMcpAndBuildTools(): Promise<McpToolsHandle> {
  const command = process.env.MCP_SERVER_COMMAND ?? "tsx";
  const argsRaw = process.env.MCP_SERVER_ARGS ?? "src/mcp/server.ts";
  const args = argsRaw.split(/\s+/).filter((a) => a.length > 0);

  const transport = new StdioClientTransport({
    command,
    args,
    cwd: process.cwd(),
    // Forward parent env so the server can read THINKLYS_API_BASE / THINKLYS_JWT.
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
  });

  const client = new Client(
    { name: "thinklys-agent-client", version: "0.1.0" },
    { capabilities: {} },
  );

  await client.connect(transport);

  const listed = await client.listTools();

  const tools: AgentTool[] = [];
  for (const entry of listed.tools) {
    const schema = LOCAL_SCHEMAS[entry.name];
    if (schema === undefined) {
      console.error(
        `[mcp-tools] warning: server advertised unknown tool "${entry.name}", skipping`,
      );
      continue;
    }

    const agentTool: AgentTool = {
      name: entry.name,
      description: entry.description ?? "",
      inputSchema: schema,
      run: async (input: unknown) => {
        const result = (await client.callTool({
          name: entry.name,
          arguments: input as Record<string, unknown>,
        })) as McpCallToolResult;

        if (result.isError === true) {
          throw new Error(concatenatedErrorText(result));
        }
        return extractPayload(result);
      },
    };

    tools.push(agentTool);
  }

  const close = async (): Promise<void> => {
    try {
      await client.close();
    } catch (err) {
      console.error("[mcp-tools] error during client close:", err);
    }
    try {
      await transport.close();
    } catch (err) {
      console.error("[mcp-tools] error during transport close:", err);
    }
  };

  return { tools, close };
}
