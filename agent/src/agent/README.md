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

## Coming in Phase 4b

Phase 4b will swap `mockTools` for tools backed by the MCP server (Phase 3). The `runAgent` signature is intentionally tool-agnostic — `runAgent(question, mcpTools)` will be a drop-in replacement.
