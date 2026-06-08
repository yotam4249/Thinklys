# Agent loop (Phase 4a)

This directory implements the **Claude tool-use loop** in TypeScript on top of `@anthropic-ai/sdk`. The loop sends the user's question plus tool definitions to Claude, executes any `tool_use` blocks the model emits, appends the matching `tool_result` blocks back into the conversation, and repeats until the model emits `end_turn` or `maxSteps` is exhausted. The tool definitions are generated from each tool's zod input schema via `zod-to-json-schema`.

## Pseudocode

```
messages = [{ role: "user", content: question }]
for step in 1..maxSteps:
    resp = anthropic.messages.create({ model, system, tools, messages })
    if resp.stop_reason != "tool_use": return text(resp)
    messages.push({ role: "assistant", content: resp.content })       # full blocks
    results = run each tool_use block and wrap as tool_result blocks
    messages.push({ role: "user", content: results })
```

## How to run with mocks

```bash
cd agent
cp .env.example .env            # set ANTHROPIC_API_KEY
npm install
npm run agent:mock -- "What do my notes say about transformers?"
```

The mock tools (`mockTools.ts`) reuse the real zod schemas from `src/tools/*` so the JSON Schema the API sees is identical to production. Their `run` implementations return canned `[MOCK] ...` data so the loop can be exercised end-to-end without any backend.

## Live MCP mode (Phase 4b)

`runAgent` is intentionally tool-agnostic — it accepts any `AgentTool[]`. In live mode the CLI:

1. Spawns `src/mcp/server.ts` as a stdio subprocess via the MCP TS SDK's
   `StdioClientTransport` (override with `MCP_SERVER_COMMAND` /
   `MCP_SERVER_ARGS`).
2. Calls `listTools()` on the connected `Client` to discover what the
   server exposes.
3. Wraps each MCP tool into an `AgentTool` whose `inputSchema` is the
   original zod schema from `src/tools/*` (kept locally for
   defense-in-depth + strict typing) and whose `run(input)` issues
   `client.callTool({ name, arguments: input })` and parses the returned
   text content blocks back into objects. `isError === true` is surfaced
   to the loop as a thrown `Error`, which the loop converts to a
   `tool_result` with `is_error: true` — so the model can recover.

All MCP-specific glue lives in `src/agent/mcpTools.ts`; `loop.ts` never
imports the MCP SDK.

### Env

- `ANTHROPIC_API_KEY` — for the Claude tool-use loop.
- `THINKLYS_API_BASE`, `THINKLYS_JWT` — passed through to the spawned
  MCP server so it can talk to the user's documents.
- `MCP_SERVER_COMMAND` (optional, defaults to `tsx`).
- `MCP_SERVER_ARGS` (optional, defaults to `src/mcp/server.ts`,
  whitespace-split into `argv`).

### Run the demo

```bash
cd agent
npm install
cp .env.example .env   # set ANTHROPIC_API_KEY, THINKLYS_API_BASE, THINKLYS_JWT
npm run demo
```

Each live run writes a structured trace to
`agent/runs/<UTC-ISO>.json` containing the question, mode, model,
final text, termination reason, step count, every tool call (input,
output, error, latency), and token counts. `agent/runs/` is gitignored.

`npm run agent:mock` is preserved for the offline path that does not
spawn a subprocess.
