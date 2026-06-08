#!/usr/bin/env tsx
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ThinklysClient } from "../data/thinklysClient.js";
import { registerTools } from "./registerTools.js";

async function main(): Promise<void> {
  const client = new ThinklysClient(); // reads THINKLYS_API_BASE / THINKLYS_JWT from env

  const server = new Server(
    { name: "thinklys-agent", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  registerTools(server, { client });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdout is reserved for the MCP JSON-RPC protocol channel — any extra
  // bytes written to it will corrupt the framing and break the client.
  // Always use console.error (stderr) for diagnostics in this process.
  console.error("[mcp] thinklys-agent server connected via stdio");
}

main().catch((err) => {
  // See note above: diagnostics must go to stderr only.
  console.error("[mcp] fatal:", err);
  process.exit(1);
});
