# Thinklys agent layer

Agentic TypeScript layer for Thinklys. Will expose user-scoped tools over uploaded documents via a custom MCP server (`@modelcontextprotocol/sdk`) and drive a Claude-based agent (`@anthropic-ai/sdk`) that answers user questions by calling those tools. An eval harness will benchmark the agent against plain top-k RAG. Details land in later phases.

## Phase status

- [x] Phase 0 — Scaffold
- [x] Phase 1 — Data access layer (user-scoped chunks + typed TS client)
- [x] Phase 2 — Tool functions (typed wrappers over the data-access client)
- [ ] Phase 3
- [x] Phase 4a — Claude tool-use loop (mock tools)
- [ ] Phase 4b
- [ ] Phase 5
- [ ] Phase 6

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

## Notes on user scoping

- New uploads tag every chunk in ChromaDB with `user_id` (from the JWT).
- Pre-existing chunks have `user_id = "__legacy__"` and will not appear
  for any real user. To clean the demo environment before re-uploading,
  run `rag-server/scripts/wipe_quiz_documents.py`.
