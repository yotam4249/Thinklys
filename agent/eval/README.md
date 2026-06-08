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

Start by editing `dataset.example.jsonl` to questions you can answer
from your own uploaded documents.

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
  (gitignored). Contains every per-case run, every judgement, the
  aggregate, and an `errors` count.

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
