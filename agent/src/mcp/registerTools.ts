import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  ALL_TOOLS,
  ToolError,
  type ToolContext,
  type ToolSpec,
} from "../tools/index.js";

const HUMAN_READABLE_JSON_THRESHOLD = 4000;

interface JsonSchemaObject {
  [key: string]: unknown;
}

function toMcpInputSchema(tool: ToolSpec<unknown, unknown>): JsonSchemaObject {
  // zod-to-json-schema returns a JSON Schema object MCP accepts directly.
  const schema = zodToJsonSchema(tool.inputSchema, {
    name: tool.name,
    $refStrategy: "none",
  }) as JsonSchemaObject;

  // When called with a `name`, the result is wrapped: { $ref, definitions: { [name]: <schema> } }.
  // Unwrap to the actual schema node so MCP gets a plain JSON Schema object.
  const definitions = schema["definitions"];
  if (
    definitions !== undefined &&
    typeof definitions === "object" &&
    definitions !== null
  ) {
    const inner = (definitions as Record<string, unknown>)[tool.name];
    if (inner !== undefined && typeof inner === "object" && inner !== null) {
      return inner as JsonSchemaObject;
    }
  }
  return schema;
}

function formatToolResultText(result: unknown): string {
  const pretty = JSON.stringify(result, null, 2);
  if (pretty.length <= HUMAN_READABLE_JSON_THRESHOLD) {
    return pretty;
  }
  return JSON.stringify(result);
}

function formatToolError(err: unknown): string {
  if (err instanceof ToolError) {
    return `ToolError [${err.code}]: ${err.message}`;
  }
  if (err instanceof Error) {
    return `Error: ${err.message}`;
  }
  return `Error: ${String(err)}`;
}

async function invokeTool<I, O>(
  tool: ToolSpec<I, O>,
  rawArgs: unknown,
  ctx: ToolContext,
): Promise<O> {
  const parsed = tool.inputSchema.parse(rawArgs);
  return tool.run(parsed, ctx);
}

export function registerTools(server: Server, ctx: ToolContext): void {
  const toolsByName = new Map<string, ToolSpec<unknown, unknown>>();
  for (const tool of ALL_TOOLS) {
    toolsByName.set(tool.name, tool);
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: ALL_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: toMcpInputSchema(tool),
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const tool = toolsByName.get(name);
    if (tool === undefined) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error: unknown tool "${name}".`,
          },
        ],
      };
    }

    try {
      const result = await invokeTool(tool, rawArgs, ctx);
      return {
        content: [
          {
            type: "text" as const,
            text: formatToolResultText(result),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: formatToolError(err),
          },
        ],
      };
    }
  });
}
