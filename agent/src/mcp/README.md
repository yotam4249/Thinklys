# Thinklys MCP server (Phase 3)

A stdio-based MCP server that exposes the Phase 2 tool functions as MCP
tools using `@modelcontextprotocol/sdk`.

## How to run

```bash
cd agent
npm install   # only needed once / after pulling
npm run mcp
```

The server speaks MCP over stdin/stdout. It will sit and wait for an MCP
client to connect — closing stdin shuts it down. Diagnostic logs are
written to stderr.

## Required environment variables

The server reads these from the process environment (via `ThinklysClient`):

| Var | Purpose |
| --- | --- |
| `THINKLYS_API_BASE` | Base URL of the py-backend (e.g. `http://localhost:8000`). |
| `THINKLYS_JWT`      | A fresh access token for the test user whose documents you want to query. |

You can place them in `agent/.env` and source it before running, or pass
them inline (`THINKLYS_JWT=... npm run mcp`).

## Verifying with MCP Inspector

The Inspector is the easiest smoke test:

```bash
cd agent
npm run mcp:inspector
```

This launches the Inspector against `tsx src/mcp/server.ts`. Then:

1. Open the Inspector URL it prints in your browser.
2. Click **Connect**.
3. Open the **Tools** tab — you should see all four tools:
   - `search_documents`
   - `list_documents`
   - `get_document_section`
   - `summarize_document`
4. Click any tool and invoke it with sample arguments, e.g.
   `list_documents` with `{}`, or `search_documents` with
   `{ "query": "test", "top_k": 3 }`. Tool errors come back with
   `isError: true` and a text payload — the protocol does not throw.

## stdout is sacred

This is a stdio MCP server: **stdout is the JSON-RPC channel**. Writing
anything to stdout (including a stray `console.log`) will corrupt the
framing and break every connected client.

In this codebase, **never use `console.log` inside the MCP server
process**. Use `console.error` for every diagnostic line — stderr is
free for human-readable output and the Inspector surfaces it under the
"Server stderr" pane.
