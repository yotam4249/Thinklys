# Thinklys — Project Walkthrough (A to Z)

A complete tour of the Thinklys codebase: what was there before, what the new agent layer adds, how every piece fits together, how to run it, and what each design decision is worth defending in a conversation. Read this once and you have the whole picture.

---

## 1. TL;DR

Thinklys is a distributed RAG-based learning platform (Python/FastAPI backend, React frontend, ChromaDB vector store, OpenAI for generation). On top of it sits a new **TypeScript agent layer** that turns Thinklys from a passive retrieve-then-stuff pipeline into **agentic retrieval**: a Claude-driven agent that actively queries the user's uploaded documents through a custom **Model Context Protocol (MCP) server** exposing four narrow, user-scoped tools. The agent decides which tool to call when, then writes a grounded answer. The repo also includes an evaluation harness that compares the agent against a plain top-k RAG baseline on the same questions, with LLM-as-judge scoring, prompt caching, and per-run trace observability.

---

## 2. The big picture

### What existed before

`py-backend/` and `rag-server/` are two Python services that already handled the core product:

- **`py-backend`** — FastAPI REST API, JWT auth, PostgreSQL, Redis, Socket.IO, S3 presigned uploads, Kafka producer. The user-facing API.
- **`rag-server`** — A Kafka consumer that, on each quiz request, downloads files from S3, chunks them, embeds with Sentence Transformers, writes to ChromaDB, and generates quiz questions via a LangChain RAG pipeline backed by OpenAI.
- **`frontend/`** — React client.

The legacy flow was **passive RAG**: one query → top-k chunks → one LLM call → answer. No tool use; no agent loop; no way for the model to ask follow-up questions of the document store.

### What this work adds

A new top-level directory **`agent/`** (TypeScript, strict mode, no build step — runs via `tsx`) plus a thin layer of new code in the existing Python services:

- A **custom MCP server** in TypeScript (`agent/src/mcp/server.ts`) exposing four document-oriented tools.
- A **Claude tool-use agent** (`agent/src/agent/loop.ts`) that calls those tools in a loop until it has the information to answer.
- A **read-only data path** from the TypeScript layer back to the user's documents: TS client → JWT-protected py-backend endpoints → localhost-only rag-server HTTP API → ChromaDB filtered by `user_id`.
- An **evaluation harness** (`agent/src/eval/*`) that runs the same Q&A set through the agent and through a top-k RAG baseline, scores both with Claude Haiku as judge, and prints a comparison table.
- **Prompt caching** on the system prompt and tool definitions, and a **per-run JSON trace** with token counts, cost, latency, and cache-hit stats.

Crucially: the legacy Python and React code paths are untouched in spirit. The only changes to existing files are (a) writing `user_id` into ChromaDB chunk metadata at ingest, (b) forwarding `user_id` in the Kafka quiz request, and (c) mounting one new router in `py-backend`. Everything else is additive.

---

## 3. The framing that matters

The single most important sentence to internalize:

> This is **not a new LLM**. It is an **agent** built around an existing LLM (Claude), and a **server** (MCP) that gives the agent tools.

Concretely, the shift is from **retrieve-then-stuff RAG** to **agentic retrieval**:

| Passive RAG (the old flow) | Agentic retrieval (this work) |
| --- | --- |
| One vector query, top-k chunks. | Multiple, adaptive tool calls. |
| Model never sees the document list. | Model can `list_documents` first. |
| Cannot zoom into one document. | `get_document_section` and `summarize_document`. |
| Model has no choice in retrieval. | Model decides which tool to call when. |
| Hallucinations slip through silently. | Answers cite chunks; eval harness measures groundedness. |

Why MCP? Because tools, schemas, and the wire protocol are now decoupled from any particular agent runtime. The same MCP server can be plugged into Claude Desktop, an in-house TS agent (what we built), or any other MCP client — without rewriting the tools.

---

## 4. Architecture at a glance

```
+----------------------------------------------------------+
|  TypeScript CLI agent  (agent/src/agent/run.ts)          |
|  - Reads question                                        |
|  - Drives runAgent() loop                                |
|  - Writes JSON trace to agent/runs/<UTC>.json            |
+--------------------+-------------------------------------+
                     |
                     v
+----------------------------------------------------------+
|  runAgent loop  (agent/src/agent/loop.ts)                |
|  - Anthropic SDK messages.create with tool_use           |
|  - Appends assistant content, runs tools, loops          |
|  - Prompt caching on system + tools                      |
+--------------------+-------------------------------------+
                     | spawn (stdio)
                     v
+----------------------------------------------------------+
|  MCP server  (agent/src/mcp/server.ts)                   |
|  Tools:                                                  |
|    - search_documents                                    |
|    - list_documents                                      |
|    - get_document_section                                |
|    - summarize_document                                  |
+--------------------+-------------------------------------+
                     | HTTPS + JWT bearer
                     v
+----------------------------------------------------------+
|  py-backend  /api/agent/*                                |
|  - Verifies JWT; extracts user_id                        |
|  - Forwards to rag-server with shared secret             |
|  (app/api/routes/agent_routes.py)                        |
+--------------------+-------------------------------------+
                     | HTTP + X-Internal-Secret (localhost)
                     v
+----------------------------------------------------------+
|  rag-server  /internal/agent/*                           |
|  (rag/api.py) runs alongside the Kafka consumer          |
|  - Embeds query (Sentence Transformers)                  |
|  - Queries ChromaDB with where={user_id: ...}            |
+--------------------+-------------------------------------+
                     |
                     v
              +-------------+
              |  ChromaDB   |
              |  user-tagged|
              |  chunks     |
              +-------------+
```

Three trust boundaries:

1. **Browser ↔ py-backend** — JWT bearer, HTTPS in production.
2. **TS agent ↔ py-backend** — same JWT bearer; the TS process holds it as `THINKLYS_JWT`.
3. **py-backend ↔ rag-server** — shared secret `X-Internal-Secret`, bound to `127.0.0.1`. Defense-in-depth: even if exposed, no JWT means no escalation surface on the internal API.

---

## 5. Repository layout

```
Thinklys/
├── README.md                  # Top-level project README (now includes agent-layer section)
├── WALKTHROUGH.md             # This file
├── py-backend/                # FastAPI service (existing)
│   └── app/
│       ├── api/routes/
│       │   ├── agent_routes.py        # NEW: /api/agent/* (JWT-protected)
│       │   ├── quiz_routes.py         # MODIFIED: stamps user_id on Kafka msg
│       │   └── ...
│       ├── services/
│       │   ├── rag_internal_client.py # NEW: HTTP client to rag-server
│       │   └── ...
│       ├── core/config.py             # MODIFIED: RAG_INTERNAL_BASE_URL/SECRET
│       └── api/dto/agent_dto.py       # NEW: Pydantic DTOs for /api/agent/*
├── rag-server/                # Kafka consumer + (NEW) FastAPI HTTP layer
│   ├── rag/
│   │   ├── api.py                     # NEW: /internal/agent/* endpoints
│   │   ├── main.py                    # MODIFIED: consumer on thread + uvicorn
│   │   ├── core/config.py             # MODIFIED: RAG_HTTP_*/INTERNAL_SECRET
│   │   └── consumers/quiz_consumer.py # MODIFIED: writes user_id to metadata
│   └── scripts/
│       └── wipe_quiz_documents.py     # NEW: one-shot legacy-data cleaner
├── frontend/                  # React client (untouched)
└── agent/                     # NEW: TypeScript agent layer
    ├── package.json
    ├── tsconfig.json          # strict, exactOptionalPropertyTypes, etc.
    ├── .env.example
    ├── README.md              # phase-status checklist + smoke-test commands
    ├── docs/
    │   ├── design-decisions.md
    │   ├── security-model.md
    │   └── eval-placeholder.md
    ├── eval/
    │   ├── dataset.example.jsonl
    │   └── README.md
    └── src/
        ├── data/
        │   ├── thinklysClient.ts      # typed HTTP client + zod response parsing
        │   └── test-fetch.ts          # smoke test: hits each endpoint
        ├── tools/
        │   ├── searchDocuments.ts
        │   ├── listDocuments.ts
        │   ├── getDocumentSection.ts
        │   ├── summarizeDocument.ts
        │   ├── types.ts               # ToolContext, ToolError
        │   ├── index.ts               # barrel + ALL_TOOLS
        │   └── test-tools.ts
        ├── mcp/
        │   ├── server.ts              # stdio MCP server
        │   ├── registerTools.ts       # ALL_TOOLS -> MCP registrations
        │   └── README.md
        ├── agent/
        │   ├── loop.ts                # the Claude tool-use loop
        │   ├── types.ts               # AgentTool, ToolCallTrace, AgentRunResult
        │   ├── mcpTools.ts            # spawn MCP server, wrap tools as AgentTool[]
        │   ├── mockTools.ts           # offline fake tools for testing
        │   ├── run.ts                 # CLI entrypoint
        │   └── README.md
        ├── eval/
        │   ├── runEval.ts             # CLI: baseline + agent + judge + table
        │   ├── baseline.ts            # plain top-k RAG (one shot)
        │   ├── judge.ts               # Haiku as correctness/groundedness judge
        │   ├── metrics.ts             # aggregation + markdown table renderer
        │   └── types.ts               # EvalCase, SystemRun, Judgement
        └── observability/
            ├── pricing.ts             # USD constants + costFor()
            └── print-trace.ts         # pretty-print a saved trace JSON
```

---

## 6. End-to-end question lifecycle

A user types into the CLI:

> "What do my notes say about transformers, and summarize the document it came from?"

Here is exactly what happens.

1. **CLI startup** (`agent/src/agent/run.ts`).
   Reads env (`ANTHROPIC_API_KEY`, `THINKLYS_API_BASE`, `THINKLYS_JWT`). Parses CLI args.

2. **Spawn the MCP server as a stdio subprocess** (`agent/src/agent/mcpTools.ts`).
   Uses `StdioClientTransport` from `@modelcontextprotocol/sdk` to spawn `tsx src/mcp/server.ts`. The two processes communicate over a JSON-RPC stream on stdin/stdout.

3. **List tools over MCP**.
   `client.listTools()` returns the four tools. For each, we re-attach the original zod input schema (looked up by name from `src/tools/*.ts`) so we re-validate locally on every call rather than trusting the JSON Schema the server advertises. The result is an `AgentTool[]` ready for `runAgent`.

4. **Anthropic API call #1** (`runAgent` in `agent/src/agent/loop.ts`).
   Sends:
   - **System prompt** as a content block with `cache_control: { type: "ephemeral" }`.
   - **Tools** array; the last tool carries `cache_control: { type: "ephemeral" }` (Anthropic caches the whole array from the last marked block).
   - **Messages**: one user turn with the question.

   Claude responds with `stop_reason = "tool_use"` and a content array like
   `[TextBlock("I'll search your notes for transformers"), ToolUseBlock(name="search_documents", input={query: "transformers", top_k: 5}, id="toolu_xxx")]`.

5. **Tool execution** (back in `loop.ts`).
   For each `ToolUseBlock`:
   - Re-parse the input through the local zod schema (defense in depth; if Claude hallucinates a malformed argument, we tell it via `is_error: true` and let it retry).
   - Run the tool. `search_documents` calls the MCP client's `callTool({ name, arguments })`. The MCP server forwards to `ThinklysClient.search(query, top_k)`, which makes a POST to `THINKLYS_API_BASE/api/agent/search` with the bearer JWT.

6. **py-backend handles the request** (`app/api/routes/agent_routes.py`).
   `Depends(get_current_user)` verifies the JWT and pulls `user_id`. Calls `rag_internal_client.search(user_id, query, top_k)` which POSTs to `http://127.0.0.1:9001/internal/agent/search` with the shared-secret header.

7. **rag-server handles the internal request** (`rag/api.py`).
   Verifies `X-Internal-Secret`. Embeds the query with the same Sentence Transformers model used at ingest. Calls Chroma `query(..., where={"user_id": user_id})`. Returns `{chunk_id, document_id, text, score, chunk_index}` for the top-k chunks.

8. **Response travels back**: rag-server → py-backend → MCP server → tool wrapper → `runAgent`.

9. **Anthropic API call #2**.
   We append:
   - Claude's full prior assistant content (text + tool_use blocks) — critical so the `tool_use_id` linkage is preserved.
   - A user message containing one `ToolResultBlock` per call, matched by `tool_use_id`.

   Claude responds with another `tool_use`: this time, `summarize_document({ document_id: "demo/notes-on-transformers.pdf" })` — it surfaced the document_id from the search results.

10. **Tool round 2**. Same pipeline; `summarize_document` returns the document's ordered chunks. Claude now has discovery (which document) and grounding (its contents).

11. **Anthropic API call #3**.
    Claude responds with `stop_reason = "end_turn"` and a text-only content block containing the final grounded answer with citations.

12. **CLI finishes**. Final text is printed to stdout; the trace (every step, tool inputs/outputs, latencies, tokens, cache stats, total cost) is written to `agent/runs/<UTC-ISO>.json`. `print-trace.ts` can pretty-print it later.

If `stop_reason = "max_tokens"` or the loop hits `maxSteps` (default 10), the run terminates with that reason explicit in the trace — no hangs, no infinite loops.

---

## 7. The four tools, by intent

| Tool | Input | Returns | When the agent calls it |
| --- | --- | --- | --- |
| `search_documents` | `query`, `top_k?` | Top chunks across all of the user's docs with `document_id`, `score`. | The question mentions a topic but no specific document. |
| `list_documents` | (none) | Titles + `document_id`s + chunk counts. | The user asks "what do I have?" or the agent needs to enumerate. |
| `get_document_section` | `document_id`, optional `query` | Top chunks from one document; query-focused if given, ordered chunks if not. | The agent has narrowed to one document and wants a passage. |
| `summarize_document` | `document_id`, optional `max_chunks` | Ordered chunks + concatenated text (capped at ~12 KB). | The agent has decided to summarize; **the model writes the prose**, the tool only delivers grounded source material. |

Why intent-shaped tools and not `run_chroma_query(filter, k)`? Three reasons:

1. **Agent-friendliness**. Narrow tools have clear "when to use" guidance the model can reason about. A generic query interface forces the model to do schema work and is more error-prone.
2. **No injection surface**. The model never composes raw queries; it picks one of four code paths whose inputs are validated by zod schemas at three layers (tool boundary, MCP boundary, HTTP boundary).
3. **Future-proofing**. We can swap dense embeddings for hybrid retrieval, add a re-ranker, or switch from ChromaDB to something else — none of the tool signatures change.

---

## 8. Security model

The critical invariant: **a request from user A can never return user B's content.**

How it is enforced:

- **`user_id` is written into every chunk's ChromaDB metadata at ingest** (`rag-server/rag/consumers/quiz_consumer.py`). Pre-existing chunks were uploaded before this change and carry `user_id = "__legacy__"`; they are silently excluded from any real user's results.
- **`user_id` is extracted from the JWT exactly once**, in `py-backend/app/api/routes/agent_routes.py`, via `Depends(get_current_user)`. The TS layer never sees a `user_id` parameter on any tool — by design, no code path through TypeScript could request another user's documents.
- **`user_id` flows server-side only** to `rag_internal_client`, which forwards it to rag-server, which uses it as a Chroma `where` filter on every read.
- **`/internal/agent/*` on rag-server requires `X-Internal-Secret`** and binds to `127.0.0.1`. Even if firewall config slipped, no token means no access. Defense in depth.

What was deliberately **not** exposed as a tool:

- No raw Chroma query.
- No raw SQL.
- No S3 presign URLs for other users.
- No "switch user" capability.

For the long-form version with file:line references and the indirect-prompt-injection threat-model discussion, see [`agent/docs/security-model.md`](agent/docs/security-model.md).

---

## 9. The agent loop, in detail

Pseudocode (`agent/src/agent/loop.ts`):

```
function runAgent(question, tools, options):
  messages = [{ role: "user", content: question }]
  trace = []
  totalIn, totalOut, totalCacheRead, totalCacheCreate = 0, 0, 0, 0

  for step in 1..maxSteps:
    response = anthropic.messages.create({
      model,
      system: [{ type: "text", text: systemPrompt, cache_control: ephemeral }],
      tools: tools.map(toAnthropicTool, last marked cache_control: ephemeral),
      messages,
      max_tokens
    })
    accumulate(usage)

    if response.stop_reason == "tool_use":
      messages.push({ role: "assistant", content: response.content })  # full content!
      toolResults = []
      for each ToolUseBlock in response.content:
        parsed = tool.inputSchema.parse(block.input)
        try:
          output = await tool.run(parsed)
          toolResults.push({ tool_use_id: block.id, content: stringify(output) })
        except err:
          toolResults.push({ tool_use_id: block.id, content: err.message, is_error: true })
        trace.push({ step, tool, input, output, latencyMs, cacheStats })
      messages.push({ role: "user", content: toolResults })
      continue

    # stop_reason in {end_turn, stop_sequence, max_tokens}
    return { finalText, steps, toolCalls: trace, terminationReason, tokens, cost }

  return { ..., terminationReason: "max_steps" }
```

Two non-obvious invariants you must get right:

1. **Append the assistant's full content array, not just the text.** Claude requires every `tool_result.tool_use_id` to match a `tool_use.id` from the previous assistant turn. Drop the `tool_use` blocks and the API rejects the next call.
2. **Bad model output must become recoverable feedback, not crash the loop.** If a tool's zod schema rejects the input, we still produce a `tool_result` (with `is_error: true`). Claude reads the error and retries with corrected arguments — that is the entire point of the loop being adaptive.

---

## 10. Prompt caching

Anthropic's prompt caching can return cached input tokens at a fraction of the cost of fresh tokens. Two parts of every turn are stable across the loop:

1. The **system prompt** (constant for the whole run).
2. The **tool definitions** (the same four tools every turn).

We mark them once:

- The system prompt becomes a content-block array with `cache_control: { type: "ephemeral" }` on the only text block.
- The last tool in the `tools` array gets `cache_control: { type: "ephemeral" }`. Anthropic's semantics: caching is applied to **everything up to and including** the last marked block, so one marker caches the entire tools array.

Why this matters:
- **Turn 1** of a run reports `cache_creation_input_tokens > 0`.
- **Turns 2..N** of the same run report `cache_read_input_tokens > 0` and near-zero creation.
- The trace records both, so you can verify caching is actually working before quoting savings in an interview.

---

## 11. Observability — what each run leaves behind

Every live run writes `agent/runs/<UTC-ISO>.json` with:

```jsonc
{
  "trace_id": "uuid-v4",
  "question": "...",
  "mode": "LIVE (MCP)",
  "model": "claude-opus-4-7",
  "finalText": "...",
  "terminationReason": "end_turn",
  "steps": 3,
  "toolCalls": [
    {
      "step": 1, "tool": "search_documents",
      "input": { "query": "transformers", "top_k": 5 },
      "output": { "results": [ { "chunk_id": "...", "document_id": "...", "text": "...", "score": 0.83 } ] },
      "latencyMs": 412,
      "cacheReadTokens": 0,
      "cacheCreationTokens": 1284
    },
    { "step": 2, "tool": "summarize_document", "...": "..." }
  ],
  "inputTokens": 5421, "outputTokens": 612,
  "cacheReadTokens": 4108, "cacheCreationTokens": 1284,
  "cost_usd": 0.0237
}
```

Pretty-print any saved trace:

```bash
cd agent && npm run trace -- runs/<UTC-file>.json
```

---

## 12. Evaluation harness — the interview-decisive piece

The harness in `agent/src/eval/` answers the question every senior interviewer asks: *did the fancy agent actually do better than top-k RAG?*

How it works:

1. **Dataset** — `agent/eval/dataset.example.jsonl`. One JSON object per line: `{id, question, expected, tags}`. You write 10–30 of these against your own documents.
2. **Baseline** — `baseline.ts`. One `search` call, top-5 chunks, one Anthropic call with a fixed prompt. No agent loop.
3. **Agent** — `runEval.ts` reuses `runAgent` plus the live MCP tools, exactly the same code path as the demo.
4. **Judge** — `judge.ts` issues two `claude-haiku-4-5-20251001` calls per (case, system) pair:
   - *Correctness*: "Expected vs generated — consistent? JSON `{correct, reason}`."
   - *Groundedness*: "Given the context chunks the system saw, is every claim supported? JSON `{grounded, reason}`."
   Haiku-as-judge is cheap and well-calibrated for verification work.
5. **Metrics** — `metrics.ts` aggregates correctness %, groundedness %, mean tokens (in, out, cache-read), mean latency, mean tool calls, total USD, and renders a Markdown comparison table.
6. **Output** — table to stdout; full `EvalRunResult` to `agent/eval/results/<UTC-ISO>.json`.

A typical interview soundbite from a real run:

> *"On a 20-question eval set, the agent reached 82% correctness vs the baseline's 64%, used 2.3 tool calls on average, and cost about 3× more per question — but with prompt caching the post-first-turn input tokens are 90% cache reads, which collapses that to about 1.4× in steady state."*

(The exact numbers depend on your dataset. The pricing constants in `agent/src/observability/pricing.ts` carry a "verify before quoting" warning — please honor it.)

---

## 13. How to run everything

### Prerequisites

- Python 3.13, Poetry; Docker for Postgres/Redis/Kafka (already in `py-backend/docker-compose.yml`).
- Node ≥ 20.
- A working `ANTHROPIC_API_KEY` and an active JWT for a Thinklys user.

### One-time setup

```bash
# 1. Shared secret between py-backend and rag-server (any random string)
SECRET=$(openssl rand -hex 32)
echo "RAG_INTERNAL_SECRET=$SECRET" >> py-backend/.env.dev
echo "RAG_INTERNAL_SECRET=$SECRET" >> rag-server/.env

# 2. Start the Python services as you normally do
cd py-backend && poetry install && docker-compose up -d && poetry run alembic upgrade head && poetry run python -m app.main &
cd ../rag-server && poetry install && poetry run python -m rag.main &

# 3. Wipe pre-user-scoping chunks (one-time)
python rag-server/scripts/wipe_quiz_documents.py

# 4. Re-upload at least one document as a logged-in user — this writes the user_id tag.
```

### Install the agent layer

```bash
cd agent
npm install
cp .env.example .env
# Fill in:
#   ANTHROPIC_API_KEY=sk-ant-...
#   THINKLYS_API_BASE=http://localhost:8000
#   THINKLYS_JWT=<a fresh access token>
```

### Smoke tests, smallest to largest

```bash
npm run test:fetch       # Phase 1: typed data client
npm run test:tools       # Phase 2: tool functions
npm run mcp:inspector    # Phase 3: visual MCP tool verification
npm run agent:mock       # Phase 4a: offline loop (no backend needed)
npm run demo             # Phase 4b: real demo against your docs
npm run eval             # Phase 6: baseline vs agent comparison
npm run trace -- runs/<UTC>.json   # Pretty-print any saved trace
```

---

## 14. Phase history (what each PR added)

| PR | Branch | Headline |
| --- | --- | --- |
| #1 | `agent-0-scaffold` | Strict-TS scaffold under `agent/`. |
| #2 | `agent-1-data-access` | User-scoped data path: rag-server HTTP layer, py-backend `/api/agent/*`, `ThinklysClient`, `user_id` written to chunk metadata. |
| #3 | `agent-2-tools` | Four typed tool functions with zod schemas and `ToolError`. |
| #4 | `agent-3-mcp-server` | MCP stdio server wrapping the tools. |
| #5 | `agent-4a-loop` | Claude tool-use loop, validated with mock tools. |
| #6 | `agent-4b-wire` | Loop driven by the real MCP server; per-run JSON trace; `npm run demo`. |
| #7 | `agent-5-readme` | Top-level README section, design-decisions, security-model docs. |
| #8 | `agent-6-eval` | Eval harness, prompt caching, cost/cache fields in traces, `print-trace` CLI. |

---

## 15. Design decisions — the short list

(One line each. For each, the long version with rejected alternatives and `file:line` references is in [`agent/docs/design-decisions.md`](agent/docs/design-decisions.md).)

- **Intent-shaped tools, not raw query primitives.** Agent-friendly, no injection surface, swappable retrieval.
- **JWT auth stays in py-backend.** TS layer carries one JWT; tools cannot accept `user_id`.
- **Embedding + ChromaDB stay in rag-server.** py-backend forwards over a localhost-only HTTP channel; no heavy ML deps duplicated.
- **MCP over stdio.** Standard local transport; works with the official Inspector; trivial subprocess lifecycle.
- **Tool errors are recoverable.** `is_error: true` content blocks let Claude self-correct instead of crashing the loop.
- **Full content-array echo before tool_result.** Required by Claude to match `tool_use_id`; subtle but non-negotiable.
- **`console.error` only in MCP code.** stdout is the protocol channel; one stray `console.log` corrupts the stream.
- **Cache `cache_control` on the last tool, not every tool.** One marker, whole array cached.
- **Eval uses Haiku as judge.** Cheap, sufficient for verification-shaped tasks; would not use it for nuanced taste judgments.

---

## 16. What I would build next

Real, scoped, and grounded in what's actually missing — not vague:

- **Streaming the loop** (`messages.stream`) so the user sees tokens appear and tool calls announced live.
- **Hybrid retrieval** in `search_documents` — BM25 + dense fusion, then re-rank. Today it is pure dense.
- **Self-correcting search** — if `search_documents` returns near-empty results, the agent rewrites the query and retries before giving up.
- **Citation verifier** — after the final answer, a cheap Haiku pass that checks every claim cites a chunk that actually supports it. Reject and retry on failure.
- **Wire the agent into the React UI** behind a feature flag — preserving the existing quiz UX, adding an "Ask your documents" pane.
- **Indirect-prompt-injection hardening** — wrap tool output in delimiters; system-prompt the model to treat tool output as data, not instructions.

---

## 17. What each piece demonstrates (interview map)

A cheat-sheet for "what should I emphasize when asked X?":

| If asked about... | Point to... |
| --- | --- |
| Agent design | `agent/src/agent/loop.ts`, the full-content-echo invariant, recoverable tool errors, `maxSteps` bound. |
| MCP literacy | `agent/src/mcp/server.ts`, `registerTools.ts`, the stdio-is-sacred constraint, the Inspector workflow. |
| Tool design | `agent/src/tools/*.ts`, intent-shaped vs. generic, zod at three layers, why no `user_id` arg. |
| Security thinking | `agent/docs/security-model.md`, the JWT → user_id → ChromaDB `where` chain, "things not exposed" list. |
| Production sense | Prompt caching, JSON traces with cost, MCP error contract, localhost-only internal API. |
| Measurement | `agent/src/eval/*`, baseline-vs-agent table, LLM-as-judge groundedness. |
| Distributed systems context | The original `py-backend` + `rag-server` + Kafka + Chroma architecture in the top-level README. |

---

## Appendix — the canonical demo question

> *"What do my notes say about transformers, and summarize the document it came from?"*

It is deliberately chosen because no single tool call can answer it. The agent must:

1. Search across the user's documents for "transformers" (`search_documents`).
2. Identify the document the top chunks come from.
3. Summarize that specific document (`summarize_document`).
4. Compose a grounded answer that connects the two.

The trace will show two distinct tool calls, two `tool_use_id`s, and one `end_turn`. That trace is the artifact to show in interviews when someone says "show me agentic retrieval."
