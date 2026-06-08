# Thinklys agent layer

Agentic TypeScript layer for Thinklys. Will expose user-scoped tools over uploaded documents via a custom MCP server (`@modelcontextprotocol/sdk`) and drive a Claude-based agent (`@anthropic-ai/sdk`) that answers user questions by calling those tools. An eval harness will benchmark the agent against plain top-k RAG. Details land in later phases.

## Phase status

- [x] Phase 0 — Scaffold
- [x] Phase 1 — Data access layer (user-scoped chunks + typed TS client)
- [x] Phase 2 — Tool functions (typed wrappers over the data-access client)
- [x] Phase 3 — MCP server (stdio) exposing the Phase 2 tools
- [x] Phase 4a — Claude tool-use loop (mock tools)
- [x] Phase 4b — Wire the agent loop to the real MCP server over stdio
- [ ] Phase 5
- [x] Phase 6 — Eval harness, observability, prompt caching

## Quickstart for now

```bash
cp .env.example .env
npm install
```

## How to test Phase 1

End-to-end smoke test of the new data-access pipeline (rag-server HTTP API
+ py-backend `/api/agent/*` + typed TS client):

1. Set `RAG_INTERNAL_SECRET` to the same non-empty value in both
   `rag-server/.env` and `py-backend/.env.dev`.
2. Start `py-backend` and `rag-server` (rag-server now serves an internal
   HTTP API on `127.0.0.1:9001` alongside the Kafka consumer).
3. From this directory:
   ```bash
   cd agent
   npm install
   cp .env.example .env
   # Fill in THINKLYS_API_BASE (e.g. http://localhost:8000) and
   # THINKLYS_JWT (a fresh access token for a test user).
   npm run test:fetch
   ```

The script calls `listDocuments`, `search`, and — if the user has any
documents — `getSection` and `getChunks`, printing each result.

## How to test Phase 2

Exercises the Phase 2 tool functions (`search_documents`,
`list_documents`, `get_document_section`, `summarize_document`) through
their zod input schemas. Requires the same environment as Phase 1
(`THINKLYS_API_BASE`, `THINKLYS_JWT`, py-backend + rag-server running):

```bash
cd agent
npm run test:tools
```

The script calls each tool through the shared `ToolContext` and prints a
compact representation of the result for each.

## How to test Phase 3

Phase 3 wraps the Phase 2 tools as an MCP server over stdio. See
[`src/mcp/README.md`](src/mcp/README.md) for the full instructions —
short version:

```bash
cd agent
npm install
npm run mcp:inspector
```

Then connect from the MCP Inspector UI and verify the four tools
(`search_documents`, `list_documents`, `get_document_section`,
`summarize_document`) are listed and callable.

## How to test Phase 4a

Runs the Claude tool-use loop against the in-process mock tools (no
backend or MCP server required). Requires only `ANTHROPIC_API_KEY` in
`.env`:

```bash
cd agent
npm install
cp .env.example .env
# Set ANTHROPIC_API_KEY=...
npm run agent:mock -- "What do my notes say about transformers, and summarize the document it came from?"
```

The CLI prints each tool call in order, the final answer text, and a
summary line (steps, tools called, termination reason, token usage).
See `src/agent/README.md` for the loop pseudocode and notes.

## How to test Phase 4b

Phase 4b drops the mock tools and drives the same Claude tool-use loop
against the **real** MCP server (Phase 3) over stdio. The agent CLI
spawns `src/mcp/server.ts` as a subprocess, lists its tools via the MCP
TS SDK client, and adapts each one into an `AgentTool` for `runAgent`.

Required env (same `.env` as before):

- `ANTHROPIC_API_KEY`
- `THINKLYS_API_BASE` (e.g. `http://localhost:8000`)
- `THINKLYS_JWT` (a fresh access token for a user who has uploaded
  documents)
- Optional: `MCP_SERVER_COMMAND`, `MCP_SERVER_ARGS` to point at a
  different MCP entrypoint.

Prerequisite: `py-backend` and `rag-server` are running (same setup as
Phase 1). Then:

```bash
cd agent
npm install
npm run demo
```

The canonical demo question is *"What do my notes say about
transformers, and summarize the document it came from?"* — it is
designed to force at least two tool calls: first `search_documents` to
discover which document mentions the topic, then `summarize_document`
on the surfaced `document_id`. This exercises the agentic retrieval
narrative (discovery → grounded summarization) rather than a one-shot
top-k lookup.

Every live run also writes a structured trace to
`agent/runs/<UTC-ISO>.json` (gitignored) containing the question, mode,
model, final text, termination reason, step count, every tool call
(input, output, error, latency), and token counts. The CLI prints the
trace path at the end.

To run the offline mock path without spawning the MCP server, use
`npm run agent:mock`.

## How to test Phase 6

Phase 6 adds three things on top of the agent loop:

1. An **evaluation harness** that runs each Q&A pair through both a
   plain top-k RAG baseline and the full agent loop, then uses
   `claude-haiku-4-5-20251001` as an LLM-as-judge for correctness and
   groundedness.
2. **Tracing/observability** — every agent run now writes a
   `trace_id` (UUID v4), per-step cache stats, and a `cost_usd` field
   derived from the public token prices in
   `src/observability/pricing.ts`.
3. **Prompt caching** on the system prompt and tool definitions in
   `src/agent/loop.ts`. See `src/agent/README.md` for what is cached
   and the expected hit-rate behavior.

Steps:

1. Edit `eval/dataset.example.jsonl` to use your own questions over your
   own documents (or write a new file and pass it as the first CLI arg).
2. With `py-backend` and `rag-server` running and the env set up
   (`THINKLYS_API_BASE`, `THINKLYS_JWT`, `ANTHROPIC_API_KEY`):

   ```bash
   cd agent
   npm install
   npm run eval
   ```

3. The script prints a Markdown comparison table and writes
   `agent/eval/results/<UTC-ISO>.json`.

Pretty-print any agent trace JSON with:

```bash
npm run trace -- runs/<file>.json
```

See `eval/README.md` for the dataset format, judge limitations, and
debugging a single case.

## Notes on user scoping

- New uploads tag every chunk in ChromaDB with `user_id` (from the JWT).
- Pre-existing chunks have `user_id = "__legacy__"` and will not appear
  for any real user. To clean the demo environment before re-uploading,
  run `rag-server/scripts/wipe_quiz_documents.py`.
