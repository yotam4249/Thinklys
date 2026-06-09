# Planner-executor (`src/planner-executor/`)

A three-stage multi-agent pipeline that reuses the existing single-agent
loop (`src/agent/loop.ts`) as each executor's inner loop.

```
question
   │
   ▼  one Claude call (planner.ts)
┌─────────────────────────────────────────┐
│ Plan { reasoning, subtasks[≤5] }        │
│   Subtask { id, question,               │
│             allowedTools[], dependsOn[] │
└─────────────────────────────────────────┘
   │
   ▼  topological levels; Promise.all within each level (orchestrator.ts)
┌─────────────────────────────────────────┐
│ Executor(t1)  Executor(t2)  Executor(t3)│
│  ↘ runAgent(focused prompt,             │
│     filtered to allowedTools,           │
│     maxSteps=6)                         │
│  ↘ ExecutorResult { findings, tools,    │
│     tokens, ... }                       │
└─────────────────────────────────────────┘
   │
   ▼  one Claude call (synthesizer.ts)
┌─────────────────────────────────────────┐
│ Final grounded answer                   │
└─────────────────────────────────────────┘
```

## Files

- `types.ts` — `Plan`, `Subtask`, `ExecutorResult`, `PlannerExecutorResult`.
  `PlannerExecutorResult` is shape-compatible with `AgentRunResult` plus
  `plan` and `executorResults`.
- `planner.ts` — `planQuestion(question, tools, anthropic)` → `Plan`.
  Validates `MAX_SUBTASKS=5`, `MAX_DEPTH=2`, `allowedTools ⊆ toolNames`,
  `dependsOn` refers to earlier subtasks.
- `executor.ts` — `runExecutor(subtask, allTools, upstreamFindings)`. Filters
  tools to the subtask's `allowedTools`, prefixes the question with prior
  findings when the subtask has dependencies, calls `runAgent` with a
  focused system prompt and `maxSteps=6`.
- `synthesizer.ts` — `synthesize(originalQuestion, executorResults, anthropic)`.
  Final Claude call combining findings into a grounded answer.
- `orchestrator.ts` — `runPlannerExecutor(question, tools, options?)`. Drives
  planner → executors (level-by-level, parallel within a level) → synthesizer
  and aggregates accounting (tokens, cache, steps).
- `run.ts` — CLI entry point. Mirrors `src/agent/run.ts` exactly (same
  args, same trace shape) so a reader can A/B the two systems by hand.

## CLI

```bash
cd agent
npm run pe                                          # default demo question, live MCP
npm run pe:mock                                     # offline, fake tools
npm run pe:demo                                     # the canonical multi-hop demo
npm run pe "what does my notes say about loss?"     # custom question
```

Each run writes a trace JSON to `runs/pe-<UTC>.json` with the full plan,
per-executor findings, and aggregated metrics.

## Boundaries this honours

- **One MCP subprocess for the whole run.** The orchestrator opens it once
  and shares the connection across executors. Per-executor isolation is
  already provided by the zod re-validation at each tool boundary.
- **`allowedTools` is enforced by the orchestrator**, not by the planner's
  good intentions. An executor never sees tools outside its subtask's
  whitelist.
- **Recoverable errors.** If a single executor fails (tool error, max
  steps), its `ExecutorResult` carries `error` and a sentinel `findings`;
  the synthesizer is told and asked to acknowledge the limitation.
- **No new MCP tools, no new data path, no changes to the existing agent
  loop.** Everything is additive.

## Not done in this PR

- Wiring planner-executor into `npm run eval` as a third system. That
  lives in PR `agent-13-pe-in-eval`.
- Prompt tuning based on multi-hop numbers. If the measurement in the
  next PR shows planner-executor doesn't beat single-agent on multi-hop,
  the planner and synthesizer prompts are the first place to look — not
  the architecture.
