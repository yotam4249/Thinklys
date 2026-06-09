# Agent layer — design decisions

A long-form companion to the "Design decisions" bullets in the top-level README. Each section names the call, what we rejected, and where to verify the claim in code. Path references use `path:line` so they remain stable under refactor.

## 1. Four intent-shaped tools instead of a generic vector-query tool

**Decision.** The MCP server exposes exactly four tools — `search_documents`, `list_documents`, `get_document_section`, `summarize_document` — each with a tight zod schema and a one-paragraph description aimed at the model.

**Alternative we rejected.** A single `run_chroma_query(filter, embedding_query, k)` tool that just forwards arbitrary Chroma `where` clauses. That would be the smallest amount of TypeScript, and it would let the model do "anything". It is also the wrong shape for tool use: the model has to invent a vector-store schema in its head, the surface area for prompt-injection-into-where-clause is large, and there is no place to put a description that actually teaches the model *when* to use it.

Narrow tools are easier to call correctly. The descriptions tell Claude which tool to reach for first ("Use this first when the user's question mentions a topic but no specific document" on `search_documents`; "Use this AFTER you've identified the right document" on `summarize_document`), which is what makes the canonical demo question fan out into two ordered calls instead of one panicky guess. Validation also happens twice: the MCP server parses with zod (`agent/src/mcp/registerTools.ts:66`) and the agent loop re-parses locally before invoking the tool (`agent/src/agent/loop.ts:211`), so malformed model output never reaches the data layer.

See: `agent/src/tools/searchDocuments.ts`, `agent/src/tools/listDocuments.ts`, `agent/src/tools/getDocumentSection.ts`, `agent/src/tools/summarizeDocument.ts`.

## 2. User scoping is enforced by the JWT in py-backend, not by the model contract

**Decision.** No tool exposed to the agent takes a `user_id` argument. The TypeScript layer holds exactly one JWT (`THINKLYS_JWT`) and forwards it as `Authorization: Bearer ...` on every request (`agent/src/data/thinklysClient.ts:92`). py-backend extracts the user id from the JWT via `get_current_user` and forwards it to rag-server (`py-backend/app/api/routes/agent_routes.py:29` and `:41`).

**Alternative we rejected.** Letting the agent pass `user_id` would have been trivial — `where={user_id}` is already the only filter rag-server applies — and would have made the agent reusable across users without re-spawning. It would also have meant the model could write any string into that field. Even if Claude never does this on purpose, indirect prompt injection from document text would have made it a one-line escalation. Keeping `user_id` out of the tool surface entirely removes the question.

Defense in depth: rag-server still requires `user_id` as an explicit query param on its internal endpoints (`rag-server/rag/api.py:122`, `:170`) and uses it as a Chroma `where` filter (`rag-server/rag/api.py:131`, `:178`, `:206`, `:235`). py-backend supplies it from the JWT; there is no path from the agent to that parameter except through the JWT.

## 3. rag-server stays the only owner of embeddings and ChromaDB

**Decision.** py-backend never imports `EmbeddingService` or `VectorStore`. It calls rag-server over HTTP on `127.0.0.1:9001` using a shared-secret header (`X-Internal-Secret`). The HTTP client centralises this in `py-backend/app/services/rag_internal_client.py:37`.

**Alternative we rejected.** Two natural alternatives: (a) move the vector store into py-backend so the agent endpoints can hit Chroma directly; (b) pull embeddings into a third "embeddings service". (a) duplicates the loaded Sentence-Transformer model into every py-backend instance, which is the most expensive thing in either process. (b) is a service we do not need yet — rag-server already exists, already hosts the model, and already owns the ChromaDB on-disk store.

The HTTP hop costs a localhost round-trip per tool call and buys us a hard architectural boundary: rag-server is the single writer and single reader for embeddings. The internal endpoints are gated by a shared-secret dependency that refuses requests if the secret is unset (`rag-server/rag/api.py:85`) — misconfiguration fails closed.

## 4. MCP over stdio (not HTTP, not WebSocket)

**Decision.** Both the server (`agent/src/mcp/server.ts:17`) and the agent's MCP client (`agent/src/agent/mcpTools.ts:89`) use `StdioServerTransport` / `StdioClientTransport`.

**Alternative we rejected.** MCP also has an SSE / HTTP transport. For a local server that lives inside one repo and is spawned by the same Node process that runs the agent loop, HTTP is extra moving parts: a port to pick, a TLS story to skip, a process-lifetime question to answer. Stdio is what the official MCP Inspector launches by default and what Claude Desktop / IDE plugins use, so the same `npm run mcp` we wire into the agent loop is also the thing a human can drive from Inspector for ad-hoc QA (`agent/src/mcp/README.md`).

Subprocess lifetime is owned by the agent CLI: a `SIGINT` handler closes the MCP client and transport before exiting (`agent/src/agent/run.ts:86`), so Ctrl-C during a long live run does not leave a zombie tsx subprocess.

## 5. Tool errors are surfaced as `{ isError: true, content: [...] }` so the loop self-corrects

**Decision.** The MCP request handler catches every exception thrown by a tool and converts it to a successful JSON-RPC response with `isError: true` and a text content block (`agent/src/mcp/registerTools.ts:111`). The agent client treats `isError === true` as a thrown `Error` (`agent/src/agent/mcpTools.ts:130`), which the loop converts into a `tool_result` block with `is_error: true` (`agent/src/agent/loop.ts:249`).

**Alternative we rejected.** Throwing across the JSON-RPC boundary terminates the connection — the protocol does not have a per-call exception type. We could also have swallowed errors silently and returned empty results, but then Claude would not know to retry. Surfacing the error message as the tool's "output" lets the model read it ("upstream API error 404 — document not found") and pick a different document_id, fall back to `search_documents`, or tell the user honestly that it could not find the thing.

This pattern matters more than it sounds. The first failure mode in agent loops is "the tool returned `{}` and the model hallucinated a recovery"; surfacing real error text turns that into "the tool said 'not found' and the model retried".

## 6. The loop appends the assistant's full content array before the `tool_result` user message

**Decision.** When the model emits one or more `tool_use` blocks, the loop pushes `{ role: "assistant", content: response.content }` *with the full block array* before pushing the user-role message that carries the `tool_result` blocks (`agent/src/agent/loop.ts:178`).

**Alternative we rejected.** It is tempting to push only the text portion of the assistant turn (the "what the user reads") and synthesise a clean user-only continuation. The Claude API rejects that: every `tool_use_id` that appeared in an assistant turn must be matched by exactly one `tool_result` with the same id in the immediately following user turn. Strip the `tool_use` blocks from history and the next `messages.create` call returns a 400.

The comment on `agent/src/agent/loop.ts:176-181` records this so the next person editing the loop does not "clean up" the history and re-discover the same constraint at runtime.

## 7. `console.error` only inside the MCP server process

**Decision.** Every diagnostic line in `agent/src/mcp/server.ts` and `agent/src/mcp/registerTools.ts` goes to stderr. There are no `console.log` calls anywhere in the MCP server path.

**Alternative we rejected.** None — this is not really a choice. Stdio MCP servers use stdout as the JSON-RPC framing channel; a single byte of non-framed output corrupts every subsequent message. We surface this in three places (`agent/src/mcp/server.ts:20`, `agent/src/mcp/README.md`, and as an `[mcp-tools] warning:` example on the client side in `agent/src/agent/mcpTools.ts:114`) so the next contributor does not learn this the hard way.

For completeness: the MCP Inspector exposes server stderr in a dedicated pane, so error-stream logging is fully visible during manual QA.

## 8. Eval persistence: schema-versioned result files plus a committed JSONL index

<!-- TODO(me): rewrite this entry in my own words before I consider this PR done -->

**Decision.** Every `npm run eval` invocation now stamps a `runId` (uuid), a git SHA + dirty flag, the three model IDs in play (baseline / agent / judge), and a sha256 of the dataset file into a `RunMetadata` block on `EvalRunResult`. The full result JSON keeps living under `eval/results/` (gitignored — it can quote chunk text), but a small one-line summary is appended to `eval/index.jsonl`, which **is** committed. `npm run eval:list` reads that index and renders a recent-runs table. A typed `EVAL_SCHEMA_VERSION` literal gates both files so future readers branch on the version instead of silently reinterpreting an older shape.

**Alternative we rejected.** The obvious alternatives are (a) just timestamp the per-run JSON files and let the user `ls` them, or (b) store everything in a sqlite file. (a) is what we had: there is no way to look at a result file and know which code produced it, no way to compare across runs without re-parsing every file, and a teammate on a different machine cannot see your historical numbers because the directory is gitignored. (b) carries a binary file into git and a query layer we do not need for tens-to-hundreds of rows — JSONL is grep-able, conflict-resolvable, and round-trippable through `cat`.

The committed index plus the schemaVersion is the seam the next two PRs (cross-run diff, regression gate) attach to. Without it they would have no stable cross-machine ground truth to compare against.

Flag for me: the dataset is fingerprinted, but the **corpus** (the user's uploaded documents, which lives in ChromaDB) is not. Two runs with the same `datasetHash` against different uploaded corpora will look comparable in the table when they should not be. I want to think about whether that matters before defending this PR — read `agent/src/eval/runIndex.ts` and `agent/src/eval/runEval.ts` first.

## 9. Cross-run comparison is a read-only viewer, separate from any regression gate

<!-- TODO(me): rewrite this entry in my own words before I consider this PR done -->

**Decision.** `npm run eval:compare` only renders deltas (aggregate metrics, per-case correctness/groundedness transitions). It always exits 0, even when correctness drops to zero, and it never writes anything. The thresholds and the non-zero exit live in a *separate* command (`eval:check`, landed in PR 3).

**Alternative we rejected.** Folding "show the diff" and "fail if too bad" into one command. Tempting because in CI you usually want both — but the failure threshold is a project policy that changes over time, while looking at a diff is something I do every time I touch the eval code or the agent prompt. Coupling them forces every casual `compare` invocation to either pass a `--no-fail` flag or risk an exit code the human caller did not expect, and it puts the policy in argv instead of in a committed config file.

Separating them keeps `compare` honest as an observability tool: it never lies about the numbers, it never refuses to render, and the regression gate can layer on top by calling the same `loadResult` + `buildTransitions` helpers without inheriting any opinions.

Default pair-picking (newest two runs with matching `datasetHash`) is the right default because comparing across different datasets is rarely meaningful — but the explicit two-arg form lets me override it when I want to look at, say, an old branch vs. main. The mismatched-dataset case prints a stderr warning rather than refusing, because there are legitimate "I changed the dataset, did the agent still look sane on the overlapping cases?" moments.

## 10. Regression policy lives in a committed JSON file, not in CLI flags

<!-- TODO(me): rewrite this entry in my own words before I consider this PR done -->

**Decision.** `npm run eval:check` reads thresholds from `agent/eval/regression-config.json` (committed) and exits non-zero if any are breached. The config carries: `maxCorrectnessDropPct` (percentage points, not relative), `maxGroundednessDropPct`, `maxCostIncreaseRatio` (head/base, e.g. 1.5× allowed), `failOnNewPassToFail` (per-case correct→incorrect triggers a violation), and `checkedSystems` (subset of `["baseline", "agent"]` — empty = dry-run).

**Alternative we rejected.** Encoding the policy on the command line (`--max-corr-drop 5 --max-cost-ratio 1.5 ...`). That requires every CI invocation to repeat the flags, every developer running locally to remember them, and there is no single source of truth for "what does this project consider a regression". Encoding it in a committed file means the policy itself shows up in `git log` and PR diffs — changes to it are reviewable.

The `checkedSystems` field is the dry-run knob. Setting it to `[]` makes `eval:check` always exit 0 with a clear "no systems configured to gate" message, which is the right behaviour while the dataset is still small and the numbers are still noisy. The PR sets it to `["agent"]` by default so the gate watches the system we ship; the baseline is the control and we generally do not block on its variance.

**Refusal vs. warning on dataset mismatch.** `eval:compare` *warns* and proceeds — it's a human reading the table. `eval:check` *refuses* with a non-zero exit — comparing aggregates across different datasets is exactly the kind of footgun a regression gate must avoid by construction.

There is some duplication with `compareRuns.ts` (`findByPrefix`, `pickPair`, `loadResult`, `shortDate`, `shortId`). Extracting a shared module would be the right move once a third caller arrives; doing it pre-emptively in this PR would grow the diff into something less reviewable.

## 11. Adversarial cases live on the same dataset with a `kind` field, judged with kind-specific prompts

<!-- TODO(me): rewrite this entry in my own words before I consider this PR done -->

**Decision.** A new optional `kind` on `EvalCase` (`"prompt-injection" | "no-answer" | "ambiguous"`) switches the judge's correctness prompt at run time. The `expected` field for adversarial cases describes the *behavior* the system was supposed to exhibit (refuse, admit ignorance, disambiguate) rather than a factual answer. A single `adversarialPct` per system flows from `metrics.ts` → `EvalRunResult` → `eval/index.jsonl` → `eval:list` / `eval:compare` / `eval:check`. The regression gate adds a `maxAdversarialDropPct` threshold (default 0pp).

**Alternative we rejected.** Two natural alternatives:

1. **Separate harness for adversarial.** A `npm run eval:adversarial` with its own dataset, judge, table. Tempting because the prompts genuinely differ. Rejected because two parallel pipelines would either need to be hand-kept in sync (each PR that touches the judge has to remember to touch both) or share helpers that look very similar to what we already have. Putting adversarial cases on the same JSONL with a `kind` discriminator keeps one code path and lets the user merge normal + adversarial cases into a single eval file if they want.
2. **Tag-based dispatch** instead of a typed `kind`. Strings in `tags` ("prompt-injection", "no-answer") would technically work, but `tags` is free-form grep-bait; making the dispatch field typed (`z.enum`) means typos fail at dataset-parse time rather than silently downgrading the judge to the default correctness prompt.

Adversarial pass-rate is reported as `undefined` (rendered as `n/a (no cases)`) when the dataset has zero adversarial cases — distinct from `0%`, which would mean "we tested adversarial and the system failed all of them." That distinction matters for not silently penalising existing datasets that have no adversarial coverage yet.

`maxAdversarialDropPct` defaults to **0pp** in the shipped config (any drop is a violation). The reasoning: adversarial coverage is small (handful of cases), the metric is binary per case (so a single regression moves it a lot), and the cases that *do* exist are security-shaped — admitting hallucinations or leaking system-prompt-like text are not "noisy" regressions to tolerate.

What's deliberately not adversarial-aware yet: groundedness on adversarial cases is judged with the same standard groundedness prompt as normal cases. For `no-answer` and `prompt-injection`, the "context" is meaningful but the standard prompt may grade these unfairly (the system might "ground" a refusal in no context at all). The shipped judge prompt for groundedness already says "if the answer truthfully says it does not know because the context is insufficient, that counts as grounded" — flag for me: re-read that wording before defending this PR; I think it covers no-answer well but is fuzzier on prompt-injection refusals.

## 12. Multi-hop is a property tag, not a typed `kind`

<!-- TODO(me): rewrite this entry in my own words before I consider this PR done -->

**Decision.** Multi-hop cases are flagged by including `"multihop"` in `tags`. The judge does **not** branch on this — multi-hop questions have a real factual `expected` answer and are graded by the standard correctness prompt. A new `multihopPct` aggregate slice mirrors the adversarial one: optional on `SystemAggregate` and `RunIndexEntry`, undefined when the dataset has zero multi-hop cases. `eval:check` gains a `maxMultihopDropPct` threshold defaulting to **5pp** (vs. 0pp for adversarial).

**Alternative we rejected.** Adding `"multihop"` as a fourth `kind`. Tempting because the adversarial pattern was right there, but a `kind` is a *judging discriminator* — it changes what "correct" means. Multi-hop doesn't change what "correct" means; it changes how hard the question is. Conflating the two would force the judge dispatch to grow a no-op branch for multi-hop, and would prevent a case from being both adversarial AND multi-hop (which is plausible: imagine an ambiguous question that also requires cross-document retrieval).

`tags` is the right home: free-form, list-valued, and already used for grep-bait. The slice-by-tag pattern in `buildMultihopIdSet` is the same shape the team would use for any future "harder-than-normal" subset, without each one needing a schema change.

**Why 5pp default instead of 0pp.** Adversarial cases are binary by design — they either refused the injection or did not. Multi-hop cases are graded by the LLM judge against `expected`, and on a small dataset (~6 cases) a single jittered judge call moves the pass-rate by 16.7pp. A 0pp gate would false-positive constantly; 5pp catches a real regression (lose one case definitively) while staying robust to one or two cases being scored differently across runs.

**This PR's job in the bigger plan.** This is the measurement seam for feature 2 (planner-executor). Landing it alone lets `npm run eval eval/dataset.multihop.example.jsonl` produce a single-agent multi-hop number that the planner-executor PRs must beat — quoted in the planner-executor PR body as the bar. Without the slice, "beats the single-agent on multi-hop" has no operational definition.

## 13. Planner-executor: small typed plan, focused executors, single synthesizer

<!-- TODO(me): rewrite this entry in my own words before I consider this PR done -->

**Decision.** `src/planner-executor/` is a three-stage pipeline reusing the existing single-agent loop as the executor inner-loop. The planner is one Claude call that returns a zod-validated `Plan` of ≤5 subtasks; each `Subtask` carries an `allowedTools` whitelist and a `dependsOn` list (max depth 2). The orchestrator runs subtasks level-by-level with `Promise.all` at each level, threading prior findings into dependent subtasks. The synthesizer is one final Claude call that composes a grounded answer from all executor outputs. The result conforms to `AgentRunResult` plus `plan` and `executorResults` extras, so PR 3 can wire it into the eval as a third system without special-casing the aggregator.

**Alternative we rejected.** Several:

1. **No planner — let one agent pick subtasks dynamically as it runs.** That's what the existing single-agent loop already does. Promoting "plan first, then execute" to a separate stage is the entire point — the planner can be cheaper/dumber than the executor and can be cached/inspected/replayed independently. It also makes the tool-restriction enforceable: an executor can only call tools the planner explicitly authorized, which is a small but real injection-resistance gain.
2. **Per-executor MCP subprocess for true isolation.** Tempting because each executor is conceptually its own agent, but MCP over stdio is already a per-call validation boundary — spawning N subprocesses to run N subtasks gives essentially no extra isolation and balloons the latency/cost. Sharing one MCP subprocess across executors is correct; the orchestrator owns the lifecycle.
3. **Free-form planner output ("just write a plan in markdown").** Rejected for the same reason `kind` is `z.enum` and not a tag: a malformed plan must fail at parse time, not silently downgrade. Hard limits — `MAX_SUBTASKS=5`, `MAX_DEPTH=2`, `allowedTools` must reference real tool names, `dependsOn` must reference earlier ids — are enforced in `validatePlan` and produce a typed error the orchestrator can surface.

**Trade-off I'm consciously making.** The planner+synthesizer add two extra Claude calls per question. On a one-hop question those calls are dead weight — the planner will dutifully emit a one-subtask plan that's just the original question, and the synthesizer will rephrase the executor's answer. The bet is that on the multi-hop slice the gain (focused tool subsets, explicit dependency chaining, parallel execution within a level) outweighs the overhead. If PR 3's measurement shows the bet doesn't pay off on multi-hop, the prompts are the first thing to tune — not the architecture.

**What this PR explicitly does NOT do.** No eval integration. The existing single-agent loop, MCP server, tools, and CLI are untouched. New scripts (`pe`, `pe:mock`, `pe:demo`) live alongside the existing ones so a reader can A/B them by hand.

## 14. Planner-executor in the eval: schema v2 with optional `plannerExecutor` aggregate

<!-- TODO(me): rewrite this entry in my own words before I consider this PR done -->

**Decision.** Bump `EVAL_SCHEMA_VERSION` to 2. `SystemName` becomes `"baseline" | "agent" | "planner-executor"`. `EvalRunResult.aggregate` and `RunIndexEntry` gain an **optional** `plannerExecutor` field — present for v2 runs, absent for v1 runs. Readers (`eval:list`, `eval:compare`, `eval:check`) tolerate the absence by showing `-` / `n/a` / skipping the system with a stderr warning, never by crashing. The `RunIndexEntrySchema` accepts `schemaVersion: z.union([z.literal(1), z.literal(2)])` so v1 entries continue to parse.

A new `EVAL_SYSTEMS` env var selects which of `baseline,agent,planner-executor` to run. Default is all three. Setting `EVAL_SYSTEMS=baseline,agent` skips planner-executor — handy because planner-executor doubles the per-case API cost (planner + N executors + synthesizer Claude calls vs. one agent loop).

**Alternative we rejected.** Several:

1. **Require `plannerExecutor` and refuse to read v1 entries.** Cleaner type-wise — no `if (agg.plannerExecutor !== undefined)` branches in display code. Rejected because the v1 → v2 cutover would leave every existing run unreadable until manually re-run, which defeats the whole point of having a committed index that preserves history.
2. **A `system: SystemName` array indexed everywhere** (so adding a fourth system later is a one-liner). Rejected for now because it would force every existing reader (table renderer, list CLI, compare CLI) to change shape, and we don't have a fourth system planned. The current `{baseline, agent, plannerExecutor?}` shape is honest about the small known set; if a fourth system arrives, that PR can do the refactor as its first commit.
3. **Default `checkedSystems: ["agent", "planner-executor"]`.** Logically correct — if you ship planner-executor you probably want to gate on it. Rejected as a default because anyone running `eval:check` on a v1 history would suddenly see `[planner-executor] missing from one of the runs; skipping` warnings on every previous run. Default stays `["agent"]`; the README recommends adding `"planner-executor"` once you have a few v2 runs in the index.

**Naming asymmetry to be aware of.** `SystemName` uses kebab-case (`"planner-executor"`) for argv/config compatibility. The aggregate key in `EvalRunResult.aggregate` and `RunIndexEntry` uses camelCase (`plannerExecutor`) because JS object keys with hyphens are bracket-only access. A small `aggregateKeyFor(system)` helper in `checkRuns.ts` does the conversion. This asymmetry shows up in exactly one place and is documented at the helper.

**The measurement claim.** The PR body quotes the actual head-to-head numbers from running `npm run eval eval/dataset.multihop.example.jsonl`. I am NOT padding the body with a number I haven't seen. If the run hasn't happened yet at the time the PR is opened, the body says so explicitly and links to the result file after the run.

---

## What's not in here

The eval plan (how we measure that this is actually better than top-k RAG) is in `agent/docs/eval-placeholder.md`. The user-scoping threat model lives in `agent/docs/security-model.md`. Phase 6 will land the real eval harness, tracing, and prompt caching — those are not documented here yet.
