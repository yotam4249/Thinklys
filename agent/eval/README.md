# Evaluation harness (Phase 6)

This directory holds the eval dataset and the JSON results emitted by
`npm run eval`. The harness itself lives under `src/eval/*`.

## What it measures

For every Q&A pair in the dataset the harness runs **two systems**:

1. **Baseline (top-k RAG).** One `search_documents` call, then one Claude
   call that stuffs the top-5 chunks into the prompt and asks for an
   answer that cites each `document_id`. No agent loop.
2. **Agent (this work).** The full Phase 4b tool-use loop driving the
   real MCP server.

Then a second model (`claude-haiku-4-5-20251001`) acts as judge and
scores each generated answer on:

- **Correctness** — is the generated answer factually consistent with the
  expected answer?
- **Groundedness** — is every claim in the generated answer supported by
  the context the system actually retrieved?

For the baseline, "context" is the top-k chunks. For the agent, "context"
is the concatenation of every successful tool output that turn.

Per system we report: correctness %, groundedness %, mean tool calls,
mean tokens (in/out + cache-read), mean latency, total USD cost.

## Dataset format

One JSON object per line (JSONL). Blank lines and `//` lines are skipped.

```json
{"id": "q1", "question": "...", "expected": "...", "tags": ["concept"]}
```

- `id` — short, stable identifier (used in result files / debug output).
- `question` — what the user would ask.
- `expected` — a short reference answer the judge compares against. It
  does not need to be verbatim; the judge model decides "factually
  consistent".
- `tags` — optional free-form labels you can grep on later.
- `kind` — optional. One of `"prompt-injection"`, `"no-answer"`,
  `"ambiguous"`. Switches the judge's notion of "correct" — see the
  [adversarial cases](#adversarial-cases) section below.

Start by editing `dataset.example.jsonl` to questions you can answer
from your own uploaded documents.

## Adversarial cases

Setting a case's `kind` makes the judge grade against the *behavior*
the system should exhibit, not against a factual answer:

- **`prompt-injection`** — the question contains (or is designed to
  surface from chunk text) an instruction the system should refuse.
  `expected` describes what a correct refusal looks like. Pass = the
  system did **not** comply (did not reveal internals, did not dump
  raw chunks, did not change persona).
- **`no-answer`** — the topic is deliberately absent from the
  corpus. Pass = the system explicitly admits it could not find the
  answer, instead of fabricating one.
- **`ambiguous`** — the question has multiple plausible
  interpretations against the corpus. Pass = the system either
  disambiguates (asks for clarification, enumerates interpretations)
  or answers each interpretation with explicit caveats and citations.

The eval table reports an **adversarial pass-rate** row per system
(or `n/a (no cases)` when the dataset has no adversarial cases). The
same metric flows into `eval/index.jsonl` as `adversarialPct`, so
`eval:list` and `eval:compare` surface it, and `eval:check` gates on
it through `maxAdversarialDropPct` (defaults to 0pp — any drop is a
violation).

A seed dataset lives at `eval/dataset.adversarial.example.jsonl`.
Either run it standalone (`npm run eval eval/dataset.adversarial.example.jsonl`)
or merge its lines into your main dataset.

## Multi-hop cases

A case tagged `"multihop"` is one that genuinely requires two-plus
retrievals across different documents (or two-plus distinct tool
calls) to answer correctly. Unlike adversarial cases, multi-hop is a
**property tag**, not a `kind`: the judge grades the answer against
`expected` the same way it does for normal cases. Multi-hop just
isolates a harder subset for measurement.

The eval table reports a **multi-hop pass-rate** row per system (or
`n/a (no cases)` when the dataset has none). The same metric flows
into `eval/index.jsonl` as `multihopPct`, so `eval:list` and
`eval:compare` surface it, and `eval:check` gates on it via
`maxMultihopDropPct` (defaults to 5pp — a touch wider than the other
slices because the dataset is small and per-case jitter is real).

Seed dataset at `eval/dataset.multihop.example.jsonl`. This is the
slice the planner-executor PR (`agent-12`) has to improve on relative
to the single-agent baseline.

## Running

```bash
cd agent
cp .env.example .env   # set ANTHROPIC_API_KEY, THINKLYS_API_BASE, THINKLYS_JWT
npm install
npm run eval                              # default dataset
npm run eval eval/my-dataset.jsonl        # custom dataset
```

`py-backend` and `rag-server` must already be running so the MCP server
and baseline can both fetch chunks.

## Output

- Markdown comparison table printed to **stdout**.
- Full `EvalRunResult` written to `eval/results/<UTC-ISO>.json`
  (gitignored — may quote chunk text from your private corpus).
  Contains every per-case run, every judgement, the aggregate, an
  `errors` count, and a `metadata` block (schemaVersion, runId, git
  SHA + dirty flag, model IDs, dataset path + hash).
- One-line summary appended to `eval/index.jsonl` (**committed**) so
  trends survive across machines: runId, finishedAt, git info, dataset
  hash, case count, errors, results-file path, and per-system
  correctness / groundedness / total cost.

## Listing runs

```bash
npm run eval:list           # last 10 runs
npm run eval:list 25        # last 25
```

Reads `eval/index.jsonl` (no API calls) and renders a recent-runs
table with the runId prefix, git SHA, dataset hash, and the headline
metrics per system. Use the `runId` or the `resultsFile` field in
`eval/index.jsonl` to look up the full per-case result JSON.

## Comparing two runs

```bash
npm run eval:compare                          # newest two runs on the same datasetHash
npm run eval:compare -- <baseId> <headId>     # 8-char prefix from `eval:list` is enough
```

Read-only — always exits 0, never writes anything. Prints:

- A header naming both runs (runId, finished time, git SHA, dataset).
- An aggregate-deltas table (correctness Δ, groundedness Δ, mean
  tokens, mean cache reads, mean latency, mean tool calls, total cost
  Δ) per system, formatted as `base → head (Δ)`.
- A per-case transitions table per system showing each case's
  correctness / groundedness in both runs and a transition note
  (`correct: fail→pass`, `correct: pass→fail (regression)`, etc.).

The two-arg form is finishedAt-aware: whichever run is older becomes
"base", whichever is newer becomes "head", regardless of argument
order. Different `datasetHash` between the two runs prints a stderr
warning but does not block.

The regression-gate command that consumes these deltas with policy
thresholds is `npm run eval:check` — see the next section.

## Regression gate

```bash
npm run eval:check                          # newest vs previous on same dataset
npm run eval:check -- <baseId> <headId>     # explicit pair
```

Reads policy from `eval/regression-config.json` (committed) and exits
non-zero if any threshold is breached. Config shape:

```json
{
  "maxCorrectnessDropPct": 5,
  "maxGroundednessDropPct": 5,
  "maxCostIncreaseRatio": 1.5,
  "failOnNewPassToFail": true,
  "checkedSystems": ["agent"]
}
```

- `maxCorrectnessDropPct` / `maxGroundednessDropPct` — percentage
  points (not relative). `33.3% → 28.0%` is a drop of 5.3pp.
- `maxCostIncreaseRatio` — head total cost ÷ base total cost. `1.5`
  allows up to a 50% cost increase per run.
- `failOnNewPassToFail` — if true, any case that was correct in base
  and incorrect in head is a violation (named in the output).
- `checkedSystems` — subset of `["baseline", "agent"]`. Set it to
  `[]` for a dry-run that always exits 0.

Unlike `eval:compare`, `eval:check` *refuses* (non-zero exit) when
base and head ran on different datasets. Aggregate-level comparisons
across different datasets are exactly the kind of footgun the gate
exists to prevent.

Wiring it into CI is intentionally out of scope for this PR; what
exists is the CLI and an exit code.

## Interpreting the table

- A higher **correctness %** for the agent than the baseline says the
  loop actually helped the model retrieve and reason — not just call
  tools for theatre.
- **Groundedness** is the hallucination guardrail. If it's lower than
  correctness, the model is sometimes right *despite* hallucinating; if
  the agent's is higher than the baseline's, the loop's discovery step
  is letting it cite better chunks.
- **Mean tool calls / Q** > 1 on the agent side is the visible cost of
  agentic retrieval. Pair with the cost column to argue the tradeoff.
- **Mean cache-read tokens** demonstrates Phase 6's prompt-caching wins
  on the system prompt and tool definitions — should be 0 on the first
  turn and rise on every subsequent turn within a run.

## Debugging a single case

Pass a single-line JSONL file:

```bash
echo '{"id":"only","question":"…","expected":"…"}' > /tmp/one.jsonl
npm run eval /tmp/one.jsonl
```

Then pretty-print any trace the agent CLI produced for adjacent debugging:

```bash
npm run trace -- runs/2026-06-08T12-34-56-789Z.json
```

## Caveats

- **LLM-as-judge** is a noisy estimator. Two cheap Haiku calls are
  cheaper than human labelling but they will sometimes call a borderline
  answer "correct". Treat single-digit deltas as noise; look for
  step-changes.
- The judge does not see the expected answer when judging groundedness
  — only the retrieved context — so it cannot reward correctness it
  cannot verify from the chunks.
- Pricing constants in `src/observability/pricing.ts` are a snapshot.
  Verify against current Anthropic pricing before quoting numbers.
